//! Request handlers. See `kp_sync::protocol` for the list of requests and who may make
//! them.

use std::path::PathBuf;

use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use kp_store::Change;
use kp_sync::{
    files::{SHARED_KINDS, is_sha256},
    is_safe_relative,
    protocol::{
        Credentials, DeviceHello, FileNotice, Invitation, Member, NewProject, PeerInfo,
        ProjectSummary, PushResult, ROLES, Registration, ServerInfo, Session, UserInfo,
        valid_email, valid_token_text,
    },
    valid_project_id,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::{
    ApiErr, AppState,
    auth::{Authed, create_session, dummy_hash, hash_password, verify_password},
    hex,
};

/// Largest file accepted (a big federated model is a few hundred megabytes).
const MAX_BLOB: u64 = 8 << 30;
const MAX_PUSH: usize = 5_000;
const MAX_CHANGE_BYTES: usize = 16 << 20;

fn rank(role: &str) -> usize {
    ROLES.iter().position(|r| *r == role).unwrap_or(ROLES.len())
}

fn role_of(conn: &Connection, project: &str, user: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT role FROM member WHERE project_id = ?1 AND user_id = ?2",
        params![project, user],
        |r| r.get(0),
    )
    .optional()
}

/// The caller's role in the project when it is at least `needed`. Non-members are told
/// the project does not exist.
fn require(conn: &Connection, project: &str, user: i64, needed: &str) -> Result<String, ApiErr> {
    let role = role_of(conn, project, user)?
        .ok_or_else(|| ApiErr::not_found("there is no such project, or you are not a member"))?;
    if rank(&role) > rank(needed) {
        return Err(ApiErr::forbidden(match needed {
            "owner" => "only the project's owners can do that",
            _ => "you can view this project but not change it",
        }));
    }
    Ok(role)
}

fn summary(conn: &Connection, project: &str, user: i64) -> Result<ProjectSummary, ApiErr> {
    conn.query_row(
        "SELECT p.id, p.name, m.role, p.created_at FROM project p
         JOIN member m ON m.project_id = p.id AND m.user_id = ?2
         WHERE p.id = ?1",
        params![project, user],
        |r| {
            Ok(ProjectSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| ApiErr::not_found("there is no such project, or you are not a member"))
}

fn user_info(authed: &Authed) -> UserInfo {
    UserInfo {
        id: authed.id,
        email: authed.email.clone(),
        name: authed.name.clone(),
        is_admin: authed.is_admin,
    }
}

fn check_project_id(id: &str) -> Result<(), ApiErr> {
    if valid_project_id(id) {
        Ok(())
    } else {
        Err(ApiErr::bad_request("the project id is not valid"))
    }
}

/// Text from a client for display: trimmed, control characters removed, length capped.
fn clean(text: &str, max: usize) -> String {
    text.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}

pub async fn server_info(State(state): State<AppState>) -> Result<Json<ServerInfo>, ApiErr> {
    let open_signup = state.open_signup();
    state
        .run(move |conn| {
            let users: i64 = conn.query_row("SELECT COUNT(*) FROM user", [], |r| r.get(0))?;
            Ok(Json(ServerInfo {
                name: "KingPost Connect server".into(),
                version: env!("CARGO_PKG_VERSION").into(),
                open_signup,
                first_user: users == 0,
            }))
        })
        .await
}

pub async fn register(
    State(state): State<AppState>,
    Json(form): Json<Registration>,
) -> Result<Json<Session>, ApiErr> {
    let email = form.email.trim().to_owned();
    let name = clean(&form.name, 100);
    if !valid_email(&email) {
        return Err(ApiErr::bad_request(
            "that does not look like an email address",
        ));
    }
    if name.is_empty() {
        return Err(ApiErr::bad_request("please give your name"));
    }
    if form.password.chars().count() < 8 || form.password.len() > 256 {
        return Err(ApiErr::bad_request(
            "the password needs at least 8 characters",
        ));
    }
    let password = form.password;
    let hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|_| ApiErr::internal())?
        .map_err(|e| {
            eprintln!("password hashing: {e}");
            ApiErr::internal()
        })?;
    let open_signup = state.open_signup();
    state
        .run(move |conn| {
            let tx = conn.transaction()?;
            let users: i64 = tx.query_row("SELECT COUNT(*) FROM user", [], |r| r.get(0))?;
            let invited: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM invite WHERE email = ?1)",
                [&email],
                |r| r.get(0),
            )?;
            if users > 0 && !open_signup && !invited {
                return Err(ApiErr::forbidden(
                    "this server only accepts people invited to a project; ask a project owner to invite you",
                ));
            }
            let exists: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM user WHERE email = ?1)",
                [&email],
                |r| r.get(0),
            )?;
            if exists {
                return Err(ApiErr::conflict(
                    "an account with this email exists; sign in instead",
                ));
            }
            tx.execute(
                "INSERT INTO user (email, name, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4)",
                params![email, name, hash, users == 0],
            )?;
            let id = tx.last_insert_rowid();
            // Invitations waiting for this email become memberships.
            tx.execute(
                "INSERT INTO member (project_id, user_id, role)
                 SELECT project_id, ?2, role FROM invite WHERE email = ?1
                 ON CONFLICT DO NOTHING",
                params![email, id],
            )?;
            tx.execute("DELETE FROM invite WHERE email = ?1", [&email])?;
            let token = create_session(&tx, id)?;
            tx.commit()?;
            Ok(Json(Session {
                token,
                user: UserInfo {
                    id,
                    email,
                    name,
                    is_admin: users == 0,
                },
            }))
        })
        .await
}

pub async fn login(
    State(state): State<AppState>,
    Json(form): Json<Credentials>,
) -> Result<Json<Session>, ApiErr> {
    let email = form.email.trim().to_owned();
    if let Some(seconds) = state.throttle().wait(&email) {
        return Err(ApiErr::new(
            StatusCode::TOO_MANY_REQUESTS,
            format!("too many attempts; try again in {seconds} seconds"),
        ));
    }
    let lookup = email.clone();
    let user: Option<(i64, String, String, bool, String)> = state
        .run(move |conn| {
            Ok(conn
                .query_row(
                    "SELECT id, email, name, is_admin, password_hash FROM user WHERE email = ?1",
                    [&lookup],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()?)
        })
        .await?;
    let hash = user
        .as_ref()
        .map(|u| u.4.clone())
        .unwrap_or_else(|| dummy_hash().to_owned());
    let password = form.password;
    let ok = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .map_err(|_| ApiErr::internal())?;
    let Some((id, email, name, is_admin, _)) = user.filter(|_| ok) else {
        state.throttle().fail(&email);
        return Err(ApiErr::new(
            StatusCode::UNAUTHORIZED,
            "the email or password is not right",
        ));
    };
    state.throttle().succeed(&email);
    state
        .run(move |conn| {
            let token = create_session(conn, id)?;
            Ok(Json(Session {
                token,
                user: UserInfo {
                    id,
                    email,
                    name,
                    is_admin,
                },
            }))
        })
        .await
}

pub async fn logout(State(state): State<AppState>, authed: Authed) -> Result<StatusCode, ApiErr> {
    state
        .run(move |conn| {
            conn.execute(
                "DELETE FROM session WHERE token_hash = ?1",
                [&authed.token_hash],
            )?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

pub async fn me(authed: Authed) -> Json<UserInfo> {
    Json(user_info(&authed))
}

pub async fn list_projects(
    State(state): State<AppState>,
    authed: Authed,
) -> Result<Json<Vec<ProjectSummary>>, ApiErr> {
    state
        .run(move |conn| {
            let mut statement = conn.prepare(
                "SELECT p.id, p.name, m.role, p.created_at FROM member m
                 JOIN project p ON p.id = m.project_id
                 WHERE m.user_id = ?1 ORDER BY p.name COLLATE NOCASE",
            )?;
            let rows = statement.query_map([authed.id], |r| {
                Ok(ProjectSummary {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    role: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })?;
            Ok(Json(rows.collect::<rusqlite::Result<_>>()?))
        })
        .await
}

pub async fn create_project(
    State(state): State<AppState>,
    authed: Authed,
    Json(form): Json<NewProject>,
) -> Result<Json<ProjectSummary>, ApiErr> {
    check_project_id(&form.id)?;
    let name = clean(&form.name, 200);
    if name.is_empty() {
        return Err(ApiErr::bad_request("the project needs a name"));
    }
    state
        .run(move |conn| {
            let tx = conn.transaction()?;
            let exists: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM project WHERE id = ?1)",
                [&form.id],
                |r| r.get(0),
            )?;
            if exists {
                if role_of(&tx, &form.id, authed.id)?.is_none() {
                    return Err(ApiErr::forbidden(
                        "this project is on the server, but you are not a member of it; ask its owner to invite you",
                    ));
                }
            } else {
                tx.execute(
                    "INSERT INTO project (id, name, created_by) VALUES (?1, ?2, ?3)",
                    params![form.id, name, authed.id],
                )?;
                tx.execute(
                    "INSERT INTO member (project_id, user_id, role) VALUES (?1, ?2, 'owner')",
                    params![form.id, authed.id],
                )?;
            }
            let result = summary(&tx, &form.id, authed.id)?;
            tx.commit()?;
            Ok(Json(result))
        })
        .await
}

pub async fn get_project(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
) -> Result<Json<ProjectSummary>, ApiErr> {
    check_project_id(&id)?;
    state
        .run(move |conn| Ok(Json(summary(conn, &id, authed.id)?)))
        .await
}

fn members(conn: &Connection, project: &str) -> rusqlite::Result<Vec<Member>> {
    let mut statement = conn.prepare(
        "SELECT u.email, u.name, m.role, 0 FROM member m JOIN user u ON u.id = m.user_id
         WHERE m.project_id = ?1
         UNION ALL
         SELECT email, '', role, 1 FROM invite WHERE project_id = ?1
         ORDER BY 4, 1 COLLATE NOCASE",
    )?;
    let rows = statement.query_map([project], |r| {
        Ok(Member {
            email: r.get(0)?,
            name: r.get(1)?,
            role: r.get(2)?,
            pending: r.get::<_, i64>(3)? == 1,
        })
    })?;
    rows.collect()
}

fn owners(conn: &Connection, project: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM member WHERE project_id = ?1 AND role = 'owner'",
        [project],
        |r| r.get(0),
    )
}

pub async fn list_members(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
) -> Result<Json<Vec<Member>>, ApiErr> {
    check_project_id(&id)?;
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            Ok(Json(members(conn, &id)?))
        })
        .await
}

/// Adds a member by email, or changes their role. Someone without an account yet gets an
/// invitation that turns into membership when they sign up with that email.
pub async fn invite(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Json(form): Json<Invitation>,
) -> Result<Json<Member>, ApiErr> {
    check_project_id(&id)?;
    let email = form.email.trim().to_owned();
    if !valid_email(&email) {
        return Err(ApiErr::bad_request(
            "that does not look like an email address",
        ));
    }
    if !ROLES.contains(&form.role.as_str()) {
        return Err(ApiErr::bad_request(
            "the role must be owner, editor or viewer",
        ));
    }
    let role = form.role;
    state
        .run(move |conn| {
            let tx = conn.transaction()?;
            require(&tx, &id, authed.id, "owner")?;
            let user: Option<(i64, String, String)> = tx
                .query_row(
                    "SELECT id, email, name FROM user WHERE email = ?1",
                    [&email],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let member = match user {
                Some((user_id, email, name)) => {
                    let current = role_of(&tx, &id, user_id)?;
                    if current.as_deref() == Some("owner") && role != "owner" && owners(&tx, &id)? == 1
                    {
                        return Err(ApiErr::conflict("a project needs at least one owner"));
                    }
                    tx.execute(
                        "INSERT INTO member (project_id, user_id, role) VALUES (?1, ?2, ?3)
                         ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role",
                        params![id, user_id, role],
                    )?;
                    Member {
                        email,
                        name,
                        role,
                        pending: false,
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO invite (project_id, email, role, invited_by) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT (project_id, email) DO UPDATE SET role = excluded.role",
                        params![id, email, role, authed.id],
                    )?;
                    Member {
                        email,
                        name: String::new(),
                        role,
                        pending: true,
                    }
                }
            };
            tx.commit()?;
            Ok(Json(member))
        })
        .await
}

#[derive(Deserialize)]
pub struct EmailQuery {
    email: String,
}

/// Removes a member or an invitation. Owners remove anyone; anyone may leave.
pub async fn remove_member(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Query(query): Query<EmailQuery>,
) -> Result<StatusCode, ApiErr> {
    check_project_id(&id)?;
    let email = query.email.trim().to_owned();
    state
        .run(move |conn| {
            let tx = conn.transaction()?;
            let leaving = email.eq_ignore_ascii_case(&authed.email);
            require(
                &tx,
                &id,
                authed.id,
                if leaving { "viewer" } else { "owner" },
            )?;
            let user: Option<i64> = tx
                .query_row("SELECT id FROM user WHERE email = ?1", [&email], |r| {
                    r.get(0)
                })
                .optional()?;
            let mut removed = tx.execute(
                "DELETE FROM invite WHERE project_id = ?1 AND email = ?2",
                params![id, email],
            )?;
            if let Some(user_id) = user {
                if role_of(&tx, &id, user_id)?.as_deref() == Some("owner") && owners(&tx, &id)? == 1
                {
                    return Err(ApiErr::conflict("a project needs at least one owner"));
                }
                removed += tx.execute(
                    "DELETE FROM member WHERE project_id = ?1 AND user_id = ?2",
                    params![id, user_id],
                )?;
            }
            if removed == 0 {
                return Err(ApiErr::not_found("that person is not a member"));
            }
            tx.commit()?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

pub async fn hello(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Json(form): Json<DeviceHello>,
) -> Result<StatusCode, ApiErr> {
    check_project_id(&id)?;
    if !valid_token_text(&form.device) {
        return Err(ApiErr::bad_request("the device id is not valid"));
    }
    let machine = clean(&form.machine, 100);
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            conn.execute(
                "INSERT INTO device (project_id, device, user_id, machine) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (project_id, device) DO UPDATE SET user_id = excluded.user_id,
                   machine = excluded.machine,
                   last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![id, form.device, authed.id, machine],
            )?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

pub async fn peers(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
) -> Result<Json<Vec<PeerInfo>>, ApiErr> {
    check_project_id(&id)?;
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            let mut statement = conn.prepare(
                "SELECT d.device, COALESCE(u.name, ''), d.machine, d.last_seen FROM device d
                 LEFT JOIN user u ON u.id = d.user_id
                 WHERE d.project_id = ?1 ORDER BY d.last_seen DESC",
            )?;
            let rows = statement.query_map([&id], |r| {
                Ok(PeerInfo {
                    device: r.get(0)?,
                    user: r.get(1)?,
                    machine: r.get(2)?,
                    last_seen: r.get(3)?,
                })
            })?;
            Ok(Json(rows.collect::<rusqlite::Result<_>>()?))
        })
        .await
}

/// A change as sent: plain ids and names, a known operation, a sensible size. It may come
/// from another device than the sender's: copies pass on what they received elsewhere.
fn check_change(change: &Change) -> Result<(), ApiErr> {
    let plain = |t: &str| {
        !t.is_empty() && t.len() <= 64 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    if !valid_token_text(&change.id)
        || !valid_token_text(&change.device)
        || !plain(&change.tbl)
        || !(change.op == "upsert" || change.op == "delete")
        || change.hlc.is_empty()
        || change.hlc.len() > 100
    {
        return Err(ApiErr::bad_request(format!(
            "change {} is not valid",
            clean(&change.id, 64)
        )));
    }
    Ok(())
}

/// `PushChanges` with each change left as the text it arrived in, so it is checked once
/// and stored as sent rather than parsed and written out again.
#[derive(Deserialize)]
pub struct RawPush {
    device: String,
    changes: Vec<Box<RawValue>>,
}

pub async fn push_changes(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Json(push): Json<RawPush>,
) -> Result<Json<PushResult>, ApiErr> {
    check_project_id(&id)?;
    if !valid_token_text(&push.device) {
        return Err(ApiErr::bad_request("the device id is not valid"));
    }
    if push.changes.len() > MAX_PUSH {
        return Err(ApiErr::bad_request(format!(
            "send at most {MAX_PUSH} changes at a time"
        )));
    }
    let mut bodies: Vec<(String, String)> = Vec::with_capacity(push.changes.len());
    for raw in &push.changes {
        let text = raw.get();
        if text.len() > MAX_CHANGE_BYTES {
            return Err(ApiErr::bad_request("a change is too large"));
        }
        let change: Change = serde_json::from_str(text)
            .map_err(|_| ApiErr::bad_request("a change is not in the expected form"))?;
        check_change(&change)?;
        bodies.push((change.id, text.to_owned()));
    }
    let device = push.device;
    state
        .run(move |conn| {
            let tx = conn.transaction()?;
            require(&tx, &id, authed.id, "editor")?;
            let mut accepted = 0;
            {
                let mut insert = tx.prepare_cached(
                    "INSERT OR IGNORE INTO project_change (project_id, id, device, user_id, body)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )?;
                for (change_id, body) in &bodies {
                    // Recorded under the device that sent it, which may be passing it on.
                    accepted += insert.execute(params![id, change_id, device, authed.id, body])?;
                }
            }
            tx.commit()?;
            Ok(Json(PushResult {
                accepted,
                known: bodies.len() - accepted,
            }))
        })
        .await
}

#[derive(Deserialize)]
pub struct PageQuery {
    after: Option<i64>,
    limit: Option<usize>,
}

/// `ChangePage`, with each change passed through as stored instead of parsed and
/// serialised again.
#[derive(Serialize)]
pub struct RawChangePage {
    changes: Vec<RawSeqChange>,
    more: bool,
}

#[derive(Serialize)]
pub struct RawSeqChange {
    seq: i64,
    change: Box<RawValue>,
}

pub async fn pull_changes(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Query(page): Query<PageQuery>,
) -> Result<Json<RawChangePage>, ApiErr> {
    check_project_id(&id)?;
    let after = page.after.unwrap_or(0);
    let limit = page.limit.unwrap_or(1_000).clamp(1, MAX_PUSH);
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            let mut statement = conn.prepare_cached(
                "SELECT seq, body FROM project_change WHERE project_id = ?1 AND seq > ?2
                 ORDER BY seq LIMIT ?3",
            )?;
            let rows = statement.query_map(params![id, after, (limit + 1) as i64], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })?;
            let mut changes = Vec::new();
            for row in rows {
                let (seq, body) = row?;
                if let Ok(change) = RawValue::from_string(body) {
                    changes.push(RawSeqChange { seq, change });
                }
            }
            let more = changes.len() > limit;
            changes.truncate(limit);
            Ok(Json(RawChangePage { changes, more }))
        })
        .await
}

pub async fn list_files(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
) -> Result<Json<Vec<FileNotice>>, ApiErr> {
    check_project_id(&id)?;
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            let mut statement = conn.prepare(
                "SELECT rel_path, sha256, kind, size, user_name, published_at, imported_at
                 FROM file_notice WHERE project_id = ?1 ORDER BY seq",
            )?;
            let rows = statement.query_map([&id], |r| {
                Ok(FileNotice {
                    rel_path: r.get(0)?,
                    sha256: r.get(1)?,
                    kind: r.get(2)?,
                    size: r.get::<_, i64>(3)?.max(0) as u64,
                    user: r.get(4)?,
                    published_at: r.get(5)?,
                    imported_at: r.get(6)?,
                })
            })?;
            Ok(Json(rows.collect::<rusqlite::Result<_>>()?))
        })
        .await
}

pub async fn post_file(
    State(state): State<AppState>,
    authed: Authed,
    Path(id): Path<String>,
    Json(notice): Json<FileNotice>,
) -> Result<StatusCode, ApiErr> {
    check_project_id(&id)?;
    if !is_sha256(&notice.sha256)
        || !is_safe_relative(&notice.rel_path)
        || notice.rel_path.len() > 500
        || !SHARED_KINDS.contains(&notice.kind.as_str())
        || notice.imported_at.as_ref().is_some_and(|t| t.len() > 40)
    {
        return Err(ApiErr::bad_request("the file notice is not valid"));
    }
    state
        .run(move |conn| {
            require(conn, &id, authed.id, "editor")?;
            let held: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM project_blob WHERE project_id = ?1 AND sha256 = ?2)",
                params![id, notice.sha256],
                |r| r.get(0),
            )?;
            if !held {
                return Err(ApiErr::conflict("upload the file before announcing it"));
            }
            conn.execute(
                "INSERT OR IGNORE INTO file_notice
                   (project_id, sha256, rel_path, kind, size, user_name, user_id, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    notice.sha256,
                    notice.rel_path.replace('\\', "/"),
                    notice.kind,
                    notice.size as i64,
                    authed.name,
                    authed.id,
                    notice.imported_at
                ],
            )?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}

fn blob_path(state: &AppState, sha256: &str) -> PathBuf {
    state.data().join("blobs").join(&sha256[..2]).join(sha256)
}

pub async fn get_blob(
    State(state): State<AppState>,
    authed: Authed,
    method: Method,
    Path((id, sha)): Path<(String, String)>,
) -> Result<Response, ApiErr> {
    check_project_id(&id)?;
    if !is_sha256(&sha) {
        return Err(ApiErr::bad_request("not a file hash"));
    }
    let lookup = sha.clone();
    let size: Option<i64> = state
        .run(move |conn| {
            require(conn, &id, authed.id, "viewer")?;
            Ok(conn
                .query_row(
                    "SELECT b.size FROM project_blob pb JOIN blob b ON b.sha256 = pb.sha256
                     WHERE pb.project_id = ?1 AND pb.sha256 = ?2",
                    params![id, lookup],
                    |r| r.get(0),
                )
                .optional()?)
        })
        .await?;
    let size = size.ok_or_else(|| ApiErr::not_found("the server does not hold that file"))?;
    let path = blob_path(&state, &sha);
    let headers = [
        (
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        ),
        (
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&size.to_string()).map_err(|_| ApiErr::internal())?,
        ),
        (
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=31536000, immutable"),
        ),
    ];
    if method == Method::HEAD {
        return Ok((headers, Body::empty()).into_response());
    }
    let file = tokio::fs::File::open(&path).await.map_err(|e| {
        eprintln!("blob {sha} missing on disk: {e}");
        ApiErr::not_found("the server does not hold that file")
    })?;
    Ok((
        headers,
        Body::from_stream(tokio_util::io::ReaderStream::new(file)),
    )
        .into_response())
}

/// Receives file content named by its hash, streaming it to disk and checking the hash
/// before keeping it.
pub async fn put_blob(
    State(state): State<AppState>,
    authed: Authed,
    Path((id, sha)): Path<(String, String)>,
    body: Body,
) -> Result<StatusCode, ApiErr> {
    check_project_id(&id)?;
    if !is_sha256(&sha) {
        return Err(ApiErr::bad_request("not a file hash"));
    }
    let (project, user, lookup) = (id.clone(), authed.id, sha.clone());
    let stored: bool = state
        .run(move |conn| {
            require(conn, &project, user, "editor")?;
            Ok(conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM blob WHERE sha256 = ?1)",
                [&lookup],
                |r| r.get(0),
            )?)
        })
        .await?;
    let path = blob_path(&state, &sha);
    let mut size = 0u64;
    let mut body = body;
    if stored && path.is_file() {
        // Already here for another project: read and drop the upload.
        while let Some(frame) = body.frame().await {
            frame.map_err(|_| ApiErr::bad_request("the upload stopped"))?;
        }
        size = tokio::fs::metadata(&path).await?.len();
    } else {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).map_err(|_| ApiErr::internal())?;
        let temp = state
            .data()
            .join("tmp")
            .join(format!("{sha}.{}.part", hex(&random)));
        let mut file = tokio::fs::File::create(&temp).await?;
        let mut hasher = Sha256::new();
        let result: Result<(), ApiErr> = async {
            while let Some(frame) = body.frame().await {
                let frame = frame.map_err(|_| ApiErr::bad_request("the upload stopped"))?;
                if let Ok(data) = frame.into_data() {
                    size += data.len() as u64;
                    if size > MAX_BLOB {
                        return Err(ApiErr::new(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "the file is larger than the server accepts",
                        ));
                    }
                    hasher.update(&data);
                    file.write_all(&data).await?;
                }
            }
            file.flush().await?;
            file.sync_all().await?;
            Ok(())
        }
        .await;
        drop(file);
        let digest = hex(&hasher.finalize());
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
        if digest != sha {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(ApiErr::bad_request("the file did not match its hash"));
        }
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        if let Err(error) = tokio::fs::rename(&temp, &path).await {
            // Two copies uploading the same content at once: the first one's file stands.
            let _ = tokio::fs::remove_file(&temp).await;
            if !path.is_file() {
                return Err(error.into());
            }
        }
    }
    state
        .run(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO blob (sha256, size) VALUES (?1, ?2)",
                params![sha, size as i64],
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO project_blob (project_id, sha256) VALUES (?1, ?2)",
                params![id, sha],
            )?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}
