//! Sync through a KingPost Connect server.
//!
//! The server keeps every change and file notice it receives for a project, in arrival
//! order, and serves them to the project's members; it does not merge anything itself.
//! Each copy sends its own changes and reads everyone's from where it left off, and
//! applies them with the same newest-per-row rule as the folder transport.

use std::{fs, path::Path, time::Duration};

use kp_store::{Change, Store};
use reqwest::{
    Method, StatusCode,
    blocking::{Body, Client, RequestBuilder, Response},
};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    Identity, Peer, Result, SyncError, SyncReport,
    files::{self, BlobSource, FileNotice, hash_file, is_sha256, temp_name},
    io_error,
    protocol::{
        API, ApiError, ChangePage, Credentials, DeviceHello, Invitation, Member, NewProject,
        PeerInfo, ProjectSummary, PushChanges, PushResult, Registration, ServerInfo, Session,
        UserInfo,
    },
};

/// Changes per request, and roughly how many bytes, whichever comes first.
const PUSH_COUNT: usize = 1_000;
const PUSH_BYTES: usize = 8 << 20;
const PULL_COUNT: usize = 2_000;

/// The server's address as people type it, cleaned: scheme, host, optional port and
/// path, no trailing slash. Plain `http` is accepted (a server on the office network);
/// the interface says when a connection is not encrypted.
pub fn normalize_url(url: &str) -> Result<String> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://").unwrap_or(("https", url));
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(SyncError::Invalid(
            "the server address must start with https:// or http://".into(),
        ));
    }
    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.starts_with('/') || rest.contains(char::is_whitespace) {
        return Err(SyncError::Invalid("the server address is not valid".into()));
    }
    Ok(format!("{scheme}://{rest}"))
}

/// Encodes a query-string value: unreserved characters stay, everything else is `%XX`.
fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// A connection to a server, signed in or not.
pub struct ServerClient {
    base: String,
    token: Option<String>,
    http: Client,
}

impl ServerClient {
    pub fn new(url: &str, token: Option<&str>) -> Result<Self> {
        let base = format!("{}{API}", normalize_url(url)?);
        // The same TLS provider the updater installs; whichever comes first sets it.
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .user_agent(concat!("KingPost-Connect/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| SyncError::Network(format!("could not prepare a connection: {e}")))?;
        Ok(Self {
            base,
            token: token.map(str::to_owned),
            http,
        })
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        let request = self.http.request(method, format!("{}{path}", self.base));
        match &self.token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    fn send(request: RequestBuilder) -> Result<Response> {
        let response = request.send().map_err(|e| {
            SyncError::Network(if e.is_timeout() {
                "the server did not answer in time".to_owned()
            } else if e.is_connect() {
                "could not reach the server; check the address and the network".to_owned()
            } else {
                format!("the connection to the server failed: {e}")
            })
        })?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let message =
            response
                .json::<ApiError>()
                .map(|e| e.error)
                .unwrap_or_else(|_| match status {
                    StatusCode::UNAUTHORIZED => "please sign in again".to_owned(),
                    StatusCode::NOT_FOUND => {
                        "this address does not answer like a KingPost Connect server".to_owned()
                    }
                    _ => format!("the server answered {status}"),
                });
        Err(SyncError::Server {
            status: status.as_u16(),
            message,
        })
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        Self::send(self.request(Method::GET, path))?
            .json()
            .map_err(|e| SyncError::Network(format!("the server's answer was not understood: {e}")))
    }

    fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T> {
        Self::send(self.request(Method::POST, path).json(body))?
            .json()
            .map_err(|e| SyncError::Network(format!("the server's answer was not understood: {e}")))
    }

    fn post_empty<B: Serialize>(&self, path: &str, body: &B) -> Result<()> {
        Self::send(self.request(Method::POST, path).json(body)).map(|_| ())
    }

    pub fn info(&self) -> Result<ServerInfo> {
        self.get("/server")
    }

    pub fn register(&self, email: &str, name: &str, password: &str) -> Result<Session> {
        self.post(
            "/auth/register",
            &Registration {
                email: email.trim().to_owned(),
                name: name.trim().to_owned(),
                password: password.to_owned(),
            },
        )
    }

    pub fn login(&self, email: &str, password: &str) -> Result<Session> {
        self.post(
            "/auth/login",
            &Credentials {
                email: email.trim().to_owned(),
                password: password.to_owned(),
            },
        )
    }

    pub fn logout(&self) -> Result<()> {
        Self::send(self.request(Method::POST, "/auth/logout")).map(|_| ())
    }

    pub fn me(&self) -> Result<UserInfo> {
        self.get("/me")
    }

    pub fn projects(&self) -> Result<Vec<ProjectSummary>> {
        self.get("/projects")
    }

    /// Creates the project on the server, or returns it when the caller is already a
    /// member.
    pub fn create_project(&self, id: &str, name: &str) -> Result<ProjectSummary> {
        self.post(
            "/projects",
            &NewProject {
                id: id.to_owned(),
                name: name.to_owned(),
            },
        )
    }

    pub fn project(&self, id: &str) -> Result<ProjectSummary> {
        self.get(&format!("/projects/{id}"))
    }

    pub fn members(&self, project: &str) -> Result<Vec<Member>> {
        self.get(&format!("/projects/{project}/members"))
    }

    pub fn invite(&self, project: &str, email: &str, role: &str) -> Result<Member> {
        self.post(
            &format!("/projects/{project}/members"),
            &Invitation {
                email: email.trim().to_owned(),
                role: role.to_owned(),
            },
        )
    }

    pub fn remove_member(&self, project: &str, email: &str) -> Result<()> {
        Self::send(self.request(
            Method::DELETE,
            &format!(
                "/projects/{project}/members?email={}",
                percent_encode(email.trim())
            ),
        ))
        .map(|_| ())
    }

    pub fn hello(&self, project: &str, device: &str, machine: &str) -> Result<()> {
        self.post_empty(
            &format!("/projects/{project}/hello"),
            &DeviceHello {
                device: device.to_owned(),
                machine: machine.to_owned(),
            },
        )
    }

    pub fn peers(&self, project: &str) -> Result<Vec<PeerInfo>> {
        self.get(&format!("/projects/{project}/peers"))
    }

    pub fn push_changes(
        &self,
        project: &str,
        device: &str,
        changes: Vec<Change>,
    ) -> Result<PushResult> {
        self.post(
            &format!("/projects/{project}/changes"),
            &PushChanges {
                device: device.to_owned(),
                changes,
            },
        )
    }

    pub fn pull_changes(&self, project: &str, after: i64, limit: usize) -> Result<ChangePage> {
        self.get(&format!(
            "/projects/{project}/changes?after={after}&limit={limit}"
        ))
    }

    pub fn file_notices(&self, project: &str) -> Result<Vec<FileNotice>> {
        self.get(&format!("/projects/{project}/files"))
    }

    pub fn post_notice(&self, project: &str, notice: &FileNotice) -> Result<()> {
        self.post_empty(&format!("/projects/{project}/files"), notice)
    }

    pub fn has_blob(&self, project: &str, sha256: &str) -> Result<bool> {
        match Self::send(self.request(Method::HEAD, &format!("/projects/{project}/blobs/{sha256}")))
        {
            Ok(_) => Ok(true),
            Err(SyncError::Server { status: 404, .. }) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn put_blob(&self, project: &str, sha256: &str, path: &Path) -> Result<()> {
        let file = fs::File::open(path).map_err(io_error(path))?;
        let size = file.metadata().map_err(io_error(path))?.len();
        Self::send(
            self.request(Method::PUT, &format!("/projects/{project}/blobs/{sha256}"))
                .timeout(Duration::from_secs(6 * 3600))
                .header("content-type", "application/octet-stream")
                .body(Body::sized(file, size)),
        )
        .map(|_| ())
    }

    /// Downloads a blob to `dest` through a temporary file and checks its hash.
    pub fn get_blob(&self, project: &str, sha256: &str, dest: &Path) -> Result<()> {
        if !is_sha256(sha256) {
            return Err(SyncError::Invalid("not a file hash".into()));
        }
        let mut response = Self::send(
            self.request(Method::GET, &format!("/projects/{project}/blobs/{sha256}"))
                .timeout(Duration::from_secs(6 * 3600)),
        )?;
        let temp = temp_name(dest);
        {
            let mut file = fs::File::create(&temp).map_err(io_error(&temp))?;
            response
                .copy_to(&mut file)
                .map_err(|e| SyncError::Network(format!("the download stopped: {e}")))?;
        }
        if hash_file(&temp)? != sha256 {
            let _ = fs::remove_file(&temp);
            return Err(SyncError::Network(
                "a downloaded file did not match its hash; it will be fetched again".into(),
            ));
        }
        fs::rename(&temp, dest).map_err(io_error(dest))
    }
}

/// One project on a server, as a sync remote.
pub struct ServerRemote {
    client: ServerClient,
    project: String,
    key: String,
}

struct ServerBlobs<'a> {
    client: &'a ServerClient,
    project: &'a str,
}

impl BlobSource for ServerBlobs<'_> {
    fn available(&self, sha256: &str) -> Result<bool> {
        Ok(is_sha256(sha256) && self.client.has_blob(self.project, sha256)?)
    }

    fn fetch(&self, sha256: &str, dest: &Path) -> Result<()> {
        self.client.get_blob(self.project, sha256, dest)
    }
}

impl ServerRemote {
    pub fn new(url: &str, token: &str, project_id: &str) -> Result<Self> {
        if !crate::valid_project_id(project_id) {
            return Err(SyncError::Invalid("the project id is not valid".into()));
        }
        Ok(Self {
            key: format!("server:{}", normalize_url(url)?),
            client: ServerClient::new(url, Some(token))?,
            project: project_id.to_owned(),
        })
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    /// Sends this copy's changes and files (unless the user may only view the project),
    /// then applies what the others sent. Received files are written into
    /// `project_root`; the caller imports them.
    pub fn sync(
        &self,
        store: &Store,
        project_root: &Path,
        project_name: &str,
        who: &Identity,
    ) -> Result<SyncReport> {
        let mut report = SyncReport::default();
        let device = store.device_id().to_owned();
        let summary = match self.client.create_project(&self.project, project_name) {
            Ok(summary) => summary,
            Err(SyncError::Server { status: 403, .. }) => {
                return Err(SyncError::Invalid(
                    "this project is on the server, but you are not a member of it; ask its owner to invite you"
                        .into(),
                ));
            }
            Err(error) => return Err(error),
        };
        report.role = Some(summary.role.clone());
        self.client.hello(&self.project, &device, &who.machine)?;
        crate::snapshot_once(store)?;

        if summary.role == "viewer" {
            let after = self.sent_cursor(store)?;
            if !store.changes_to_send(after, &self.key, true, 1)?.is_empty() {
                report.conflicts.push(
                    "You can view this project but not change it; changes made here stay on this computer."
                        .into(),
                );
            }
        } else {
            report.sent = self.push_changes(store, &device)?;
            report.files_sent = self.push_files(store, project_root, who)?;
        }

        self.pull_changes(store, &device, &mut report)?;
        let notices = self.client.file_notices(&self.project)?;
        files::receive(
            store,
            project_root,
            &self.key,
            notices,
            &ServerBlobs {
                client: &self.client,
                project: &self.project,
            },
            &mut report,
        )?;
        report.peers = self
            .client
            .peers(&self.project)?
            .into_iter()
            .filter(|p| p.device != device)
            .map(|p| Peer {
                device: p.device,
                user: p.user,
                machine: p.machine,
                last_sync: p.last_seen,
            })
            .collect();
        report.applied += store.retry_pending()?;
        report.pending = store.sync_counts()?.pending as usize;
        Ok(report)
    }

    fn sent_cursor(&self, store: &Store) -> Result<i64> {
        Ok(store
            .sync_cursor(&self.key, "sent")?
            .and_then(|p| p.parse().ok())
            .unwrap_or(0))
    }

    fn push_changes(&self, store: &Store, device: &str) -> Result<usize> {
        let mut sent = 0;
        loop {
            let after = self.sent_cursor(store)?;
            // Own changes, and what arrived another way (a shared folder used before).
            let candidates = store.changes_to_send(after, &self.key, true, PUSH_COUNT)?;
            if candidates.is_empty() {
                return Ok(sent);
            }
            // Keep requests a sensible size: viewpoint snapshots can be large.
            let mut batch = Vec::new();
            let mut bytes = 0;
            let mut last = after;
            for (seq, change) in candidates {
                let size = change
                    .row
                    .as_ref()
                    .map(|r| r.to_string().len())
                    .unwrap_or(0)
                    + 200;
                if !batch.is_empty() && bytes + size > PUSH_BYTES {
                    break;
                }
                bytes += size;
                last = seq;
                batch.push(change);
            }
            let count = batch.len();
            self.client.push_changes(&self.project, device, batch)?;
            store.set_sync_cursor(&self.key, "sent", &last.to_string())?;
            sent += count;
        }
    }

    fn push_files(&self, store: &Store, project_root: &Path, who: &Identity) -> Result<usize> {
        let outgoing = files::outgoing(store, project_root, &self.key, &who.user)?;
        for file in &outgoing {
            let sha = &file.notice.sha256;
            if !self.client.has_blob(&self.project, sha)? {
                self.client.put_blob(&self.project, sha, &file.path)?;
            }
            self.client.post_notice(&self.project, &file.notice)?;
            store.mark_published(&self.key, sha)?;
        }
        Ok(outgoing.len())
    }

    fn pull_changes(&self, store: &Store, device: &str, report: &mut SyncReport) -> Result<()> {
        loop {
            let after: i64 = store
                .sync_cursor(&self.key, "received")?
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);
            let page = self.client.pull_changes(&self.project, after, PULL_COUNT)?;
            let Some(last) = page.changes.last().map(|c| c.seq) else {
                return Ok(());
            };
            let changes: Vec<Change> = page
                .changes
                .into_iter()
                .map(|c| c.change)
                .filter(|c| c.device != device)
                .collect();
            if !changes.is_empty() {
                let applied = store.apply_changes_from(&changes, &self.key)?;
                report.applied += applied.applied;
                report.skipped += applied.skipped;
            }
            store.set_sync_cursor(&self.key, "received", &last.to_string())?;
            if !page.more {
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_are_cleaned() {
        assert_eq!(
            normalize_url(" sync.firm.com/ ").unwrap(),
            "https://sync.firm.com"
        );
        assert_eq!(
            normalize_url("http://10.0.0.5:8640").unwrap(),
            "http://10.0.0.5:8640"
        );
        assert_eq!(
            normalize_url("https://firm.com/kingpost/").unwrap(),
            "https://firm.com/kingpost"
        );
        assert!(normalize_url("ftp://firm.com").is_err());
        assert!(normalize_url("https://").is_err());
        assert!(normalize_url("https://a b").is_err());
    }

    #[test]
    fn query_values_are_encoded() {
        assert_eq!(percent_encode("ann+test@firm.com"), "ann%2Btest%40firm.com");
        assert_eq!(percent_encode("plain-name_1.x~"), "plain-name_1.x~");
    }
}
