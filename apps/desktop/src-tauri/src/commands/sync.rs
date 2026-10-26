//! Sync between copies of a project, through a shared folder or a KingPost Connect
//! server.
//!
//! A sync opens its own connection to the project database so that copying large model
//! files does not hold the application state; SQLite's write-ahead log lets the rest of
//! the application keep reading and writing meanwhile. Network calls run on blocking
//! threads, never on the interface's.
//!
//! Server sign-ins are kept in the application's configuration folder, not in projects:
//! a token stands in for a password and belongs to this user on this computer.

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use kp_store::{PendingRow, Store, SyncCounts};
use kp_sync::{
    Identity, SyncError, SyncReport,
    folder::FolderRemote,
    protocol::{Member, ProjectSummary, ServerInfo, Session},
    server::{ServerClient, ServerRemote, normalize_url},
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::{AppState, describe};

static SYNCING: AtomicBool = AtomicBool::new(false);
const ACCOUNTS_FILE: &str = "sync-accounts.json";

// ---- Accounts ----

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Account {
    url: String,
    email: String,
    name: String,
    token: String,
}

/// A signed-in account as the interface sees it (never the token).
#[derive(Debug, Clone, Serialize)]
pub struct AccountInfo {
    pub url: String,
    pub email: String,
    pub name: String,
}

impl From<&Account> for AccountInfo {
    fn from(account: &Account) -> Self {
        Self {
            url: account.url.clone(),
            email: account.email.clone(),
            name: account.name.clone(),
        }
    }
}

fn accounts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.join(ACCOUNTS_FILE))
}

fn load_accounts(app: &AppHandle) -> Vec<Account> {
    accounts_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_accounts(app: &AppHandle, accounts: &[Account]) -> Result<(), String> {
    let path = accounts_path(app)?;
    let temp = path.with_extension("json.part");
    let bytes = serde_json::to_vec_pretty(accounts).map_err(describe)?;
    fs::write(&temp, bytes).map_err(|e| format!("{}: {e}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

fn account_for(app: &AppHandle, url: &str) -> Option<Account> {
    let url = normalize_url(url).ok()?;
    load_accounts(app).into_iter().find(|a| a.url == url)
}

/// Keeps one account per server: signing in again replaces the old one.
fn remember(app: &AppHandle, url: &str, session: Session) -> Result<AccountInfo, String> {
    let url = normalize_url(url).map_err(describe)?;
    let account = Account {
        url: url.clone(),
        email: session.user.email,
        name: session.user.name,
        token: session.token,
    };
    let mut accounts: Vec<Account> = load_accounts(app)
        .into_iter()
        .filter(|a| a.url != url)
        .collect();
    let info = AccountInfo::from(&account);
    accounts.push(account);
    save_accounts(app, &accounts)?;
    Ok(info)
}

fn forget(app: &AppHandle, url: &str) -> Result<(), String> {
    let url = normalize_url(url).map_err(describe)?;
    let accounts: Vec<Account> = load_accounts(app)
        .into_iter()
        .filter(|a| a.url != url)
        .collect();
    save_accounts(app, &accounts)
}

fn signed_in(app: &AppHandle, url: &str) -> Result<Account, String> {
    account_for(app, url).ok_or_else(|| format!("sign in to {url} first"))
}

/// A server error in words; an ended sign-in is forgotten so the interface asks again.
fn server_error(app: &AppHandle, url: &str, error: SyncError) -> String {
    if error.is_unauthorized() {
        let _ = forget(app, url);
        format!("your sign-in to {url} has ended; please sign in again")
    } else {
        error.to_string()
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(describe)?
}

// ---- Status and settings ----

#[derive(Debug, Serialize)]
pub struct SyncStatus {
    /// The shared folder, when the project syncs through one.
    pub folder: Option<String>,
    /// The server address, when the project syncs through one.
    pub server: Option<String>,
    /// Who is signed in to that server, if anyone.
    pub account: Option<AccountInfo>,
    /// The user's role in the project on that server, as of the last sync.
    pub role: Option<String>,
    pub auto: bool,
    pub last_sync: Option<String>,
    pub syncing: bool,
    pub counts: SyncCounts,
    pub pending: Vec<PendingRow>,
}

fn status(store: &Store, app: &AppHandle) -> Result<SyncStatus, String> {
    let setting = |key: &str| store.sync_setting(key).map_err(describe);
    let server = setting("server")?;
    Ok(SyncStatus {
        folder: setting("folder")?,
        account: server
            .as_deref()
            .and_then(|url| account_for(app, url))
            .map(|a| AccountInfo::from(&a)),
        server,
        role: setting("server_role")?,
        auto: setting("auto")?.as_deref() != Some("0"),
        last_sync: setting("last_sync")?,
        syncing: SYNCING.load(Ordering::SeqCst),
        counts: store.sync_counts().map_err(describe)?,
        pending: store.pending_changes().map_err(describe)?,
    })
}

#[tauri::command]
pub fn sync_status(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, String> {
    state.with_project(|project| status(project.store(), &app))
}

/// Makes the project sync through a shared folder (instead of a server).
#[tauri::command]
pub fn sync_set_folder(
    state: State<'_, AppState>,
    app: AppHandle,
    folder: String,
) -> Result<SyncStatus, String> {
    state.with_project(|project| {
        let path = PathBuf::from(&folder);
        if !path.is_dir() {
            return Err(format!("{folder} is not a folder that can be reached"));
        }
        if path.starts_with(project.root()) {
            return Err("choose a folder outside the project folder".to_owned());
        }
        let store = project.store();
        store
            .set_sync_setting("folder", Some(&folder))
            .and_then(|_| store.set_sync_setting("server", None))
            .and_then(|_| store.set_sync_setting("server_role", None))
            .map_err(describe)?;
        status(store, &app)
    })
}

/// Makes the project sync through a server the user is signed in to (instead of a
/// shared folder).
#[tauri::command]
pub fn sync_use_server(
    state: State<'_, AppState>,
    app: AppHandle,
    url: String,
) -> Result<SyncStatus, String> {
    let account = signed_in(&app, &url)?;
    state.with_project(|project| {
        let store = project.store();
        store
            .set_sync_setting("server", Some(&account.url))
            .and_then(|_| store.set_sync_setting("folder", None))
            .map_err(describe)?;
        status(store, &app)
    })
}

/// Stops syncing; the project's content stays as it is.
#[tauri::command]
pub fn sync_stop(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, String> {
    state.with_project(|project| {
        let store = project.store();
        for key in ["folder", "server", "server_role"] {
            store.set_sync_setting(key, None).map_err(describe)?;
        }
        status(store, &app)
    })
}

#[tauri::command]
pub fn sync_set_auto(
    state: State<'_, AppState>,
    app: AppHandle,
    on: bool,
) -> Result<SyncStatus, String> {
    state.with_project(|project| {
        project
            .store()
            .set_sync_setting("auto", Some(if on { "1" } else { "0" }))
            .map_err(describe)?;
        status(project.store(), &app)
    })
}

// ---- Syncing ----

struct Clear;

impl Drop for Clear {
    fn drop(&mut self) {
        SYNCING.store(false, Ordering::SeqCst);
    }
}

enum Remote {
    Folder(PathBuf),
    Server(Account),
}

fn identity(user: &str) -> Identity {
    Identity {
        user: if user.trim().is_empty() {
            std::env::var("USERNAME").unwrap_or_default()
        } else {
            user.trim().to_owned()
        },
        machine: std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_default(),
    }
}

/// Sends this copy's changes and files and applies the others'. Received files are
/// copied into the project; the interface imports them.
#[tauri::command]
pub async fn sync_now(
    state: State<'_, AppState>,
    app: AppHandle,
    user: String,
) -> Result<SyncReport, String> {
    let (root, database, id, name, remote) = state.with_project(|project| {
        let store = project.store();
        let remote = match (
            store.sync_setting("server").map_err(describe)?,
            store.sync_setting("folder").map_err(describe)?,
        ) {
            (Some(url), _) => Remote::Server(signed_in(&app, &url)?),
            (None, Some(folder)) => Remote::Folder(PathBuf::from(folder)),
            (None, None) => return Err("choose a shared folder or a server first".to_owned()),
        };
        Ok((
            project.root().to_path_buf(),
            project.data_dir().join(kp_project::DATABASE_FILE),
            project.manifest().id.clone(),
            project.manifest().name.clone(),
            remote,
        ))
    })?;
    if SYNCING.swap(true, Ordering::SeqCst) {
        return Err("a sync is already running".to_owned());
    }
    blocking(move || {
        let _clear = Clear;
        let store = Store::open(&database).map_err(describe)?;
        let who = identity(&user);
        let report = match &remote {
            Remote::Folder(folder) => FolderRemote::open(folder, &id, &name)
                .and_then(|remote| remote.sync(&store, &root, &who))
                .map_err(describe)?,
            Remote::Server(account) => ServerRemote::new(&account.url, &account.token, &id)
                .and_then(|remote| remote.sync(&store, &root, &name, &who))
                .map_err(|e| server_error(&app, &account.url, e))?,
        };
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        store
            .set_sync_setting("last_sync", Some(&now))
            .and_then(|_| store.set_sync_setting("server_role", report.role.as_deref()))
            .map_err(describe)?;
        Ok(report)
    })
    .await
}

/// Tries kept changes again, after received files were imported.
#[tauri::command]
pub fn sync_retry(state: State<'_, AppState>) -> Result<usize, String> {
    state.with_project(|project| project.store().retry_pending().map_err(describe))
}

// ---- Server accounts ----

#[tauri::command]
pub async fn sync_server_info(url: String) -> Result<ServerInfo, String> {
    blocking(move || {
        ServerClient::new(&url, None)
            .and_then(|c| c.info())
            .map_err(describe)
    })
    .await
}

#[tauri::command]
pub async fn sync_server_login(
    app: AppHandle,
    url: String,
    email: String,
    password: String,
) -> Result<AccountInfo, String> {
    blocking(move || {
        let session = ServerClient::new(&url, None)
            .and_then(|c| c.login(&email, &password))
            .map_err(describe)?;
        remember(&app, &url, session)
    })
    .await
}

#[tauri::command]
pub async fn sync_server_register(
    app: AppHandle,
    url: String,
    email: String,
    name: String,
    password: String,
) -> Result<AccountInfo, String> {
    blocking(move || {
        let session = ServerClient::new(&url, None)
            .and_then(|c| c.register(&email, &name, &password))
            .map_err(describe)?;
        remember(&app, &url, session)
    })
    .await
}

/// Signs out of a server: the token is revoked there (when reachable) and forgotten here.
#[tauri::command]
pub async fn sync_server_logout(app: AppHandle, url: String) -> Result<(), String> {
    blocking(move || {
        if let Some(account) = account_for(&app, &url)
            && let Ok(client) = ServerClient::new(&account.url, Some(&account.token))
        {
            let _ = client.logout();
        }
        forget(&app, &url)
    })
    .await
}

#[tauri::command]
pub fn sync_server_accounts(app: AppHandle) -> Vec<AccountInfo> {
    load_accounts(&app).iter().map(AccountInfo::from).collect()
}

/// Projects the signed-in user can join on a server.
#[tauri::command]
pub async fn sync_server_projects(
    app: AppHandle,
    url: String,
) -> Result<Vec<ProjectSummary>, String> {
    blocking(move || {
        let account = signed_in(&app, &url)?;
        ServerClient::new(&account.url, Some(&account.token))
            .and_then(|c| c.projects())
            .map_err(|e| server_error(&app, &account.url, e))
    })
    .await
}

/// Creates a local copy of a server project in `target` and points it at the server; the
/// interface opens it and the first sync fills it.
#[tauri::command]
pub fn sync_join_server(
    app: AppHandle,
    url: String,
    project_id: String,
    name: String,
    target: String,
) -> Result<String, String> {
    let account = signed_in(&app, &url)?;
    if !kp_sync::valid_project_id(&project_id) {
        return Err("the project id is not valid".to_owned());
    }
    let target_dir = PathBuf::from(&target);
    let created =
        kp_project::Project::create_with_id(&target_dir, &name, &project_id).map_err(describe)?;
    created
        .store()
        .set_sync_setting("server", Some(&account.url))
        .map_err(describe)?;
    Ok(target_dir.display().to_string())
}

// ---- Members of the open project on its server ----

fn project_server(state: &AppState, app: &AppHandle) -> Result<(Account, String), String> {
    state.with_project(|project| {
        let url = project
            .store()
            .sync_setting("server")
            .map_err(describe)?
            .ok_or_else(|| "this project does not sync through a server".to_owned())?;
        Ok((signed_in(app, &url)?, project.manifest().id.clone()))
    })
}

#[tauri::command]
pub async fn sync_members(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<Member>, String> {
    let (account, id) = project_server(&state, &app)?;
    blocking(move || {
        ServerClient::new(&account.url, Some(&account.token))
            .and_then(|c| c.members(&id))
            .map_err(|e| server_error(&app, &account.url, e))
    })
    .await
}

#[tauri::command]
pub async fn sync_invite(
    state: State<'_, AppState>,
    app: AppHandle,
    email: String,
    role: String,
) -> Result<Member, String> {
    let (account, id) = project_server(&state, &app)?;
    blocking(move || {
        ServerClient::new(&account.url, Some(&account.token))
            .and_then(|c| c.invite(&id, &email, &role))
            .map_err(|e| server_error(&app, &account.url, e))
    })
    .await
}

#[tauri::command]
pub async fn sync_remove_member(
    state: State<'_, AppState>,
    app: AppHandle,
    email: String,
) -> Result<(), String> {
    let (account, id) = project_server(&state, &app)?;
    blocking(move || {
        ServerClient::new(&account.url, Some(&account.token))
            .and_then(|c| c.remove_member(&id, &email))
            .map_err(|e| server_error(&app, &account.url, e))
    })
    .await
}

// ---- Joining from a shared folder ----

#[derive(Debug, Serialize, Deserialize)]
pub struct SharedProject {
    pub id: String,
    pub name: String,
    /// The project's folder inside the shared folder.
    pub path: String,
}

fn read_shared(dir: &std::path::Path) -> Option<SharedProject> {
    #[derive(Deserialize)]
    struct Info {
        id: String,
        name: String,
    }
    let info: Info = serde_json::from_slice(&fs::read(dir.join("project.json")).ok()?).ok()?;
    let valid = kp_sync::valid_project_id(&info.id)
        && dir.file_name().map(|n| n.to_string_lossy() == info.id) == Some(true);
    valid.then(|| SharedProject {
        id: info.id,
        name: info.name,
        path: dir.display().to_string(),
    })
}

/// Projects that sync through `folder`: the folder itself when it is one project's
/// folder, otherwise the project folders directly inside it.
#[tauri::command]
pub fn sync_shared_projects(folder: String) -> Result<Vec<SharedProject>, String> {
    let dir = PathBuf::from(&folder);
    if let Some(project) = read_shared(&dir) {
        return Ok(vec![project]);
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("{folder}: {e}"))?;
    let mut found: Vec<SharedProject> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_shared(&e.path()))
        .collect();
    found.sort_by_key(|p| p.name.to_lowercase());
    Ok(found)
}

/// Creates a local copy of a shared project in `target` (an empty folder, or one without
/// a project) and points it at the shared folder. The interface then opens it; the first
/// sync brings the content and the files.
#[tauri::command]
pub fn sync_join(shared_project: String, target: String) -> Result<String, String> {
    let dir = PathBuf::from(&shared_project);
    let project = read_shared(&dir)
        .ok_or_else(|| format!("{shared_project} is not a shared KingPost Connect project"))?;
    let target_dir = PathBuf::from(&target);
    let shared_root = dir
        .parent()
        .ok_or_else(|| "the shared folder is not valid".to_owned())?
        .to_path_buf();
    if target_dir.starts_with(&shared_root) {
        return Err("choose a folder outside the shared folder for your copy".to_owned());
    }
    let created = kp_project::Project::create_with_id(&target_dir, &project.name, &project.id)
        .map_err(describe)?;
    created
        .store()
        .set_sync_setting("folder", Some(&shared_root.display().to_string()))
        .map_err(describe)?;
    Ok(target_dir.display().to_string())
}
