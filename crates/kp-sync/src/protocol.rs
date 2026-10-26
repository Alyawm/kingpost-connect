//! What the desktop application and the sync server say to each other: JSON over HTTP
//! under `/api/v1`. Shared by both so they cannot drift apart.
//!
//! | Method and path | Who | Body → reply |
//! |---|---|---|
//! | `GET /server` | anyone | → [`ServerInfo`] |
//! | `POST /auth/register` | anyone allowed to | [`Registration`] → [`Session`] |
//! | `POST /auth/login` | anyone | [`Credentials`] → [`Session`] |
//! | `POST /auth/logout` | signed in | → nothing |
//! | `GET /me` | signed in | → [`UserInfo`] |
//! | `GET /projects` | signed in | → `[`[`ProjectSummary`]`]` |
//! | `POST /projects` | signed in | [`NewProject`] → [`ProjectSummary`] |
//! | `GET /projects/{id}` | member | → [`ProjectSummary`] |
//! | `GET /projects/{id}/members` | member | → `[`[`Member`]`]` |
//! | `POST /projects/{id}/members` | owner | [`Invitation`] → [`Member`] |
//! | `DELETE /projects/{id}/members?email=` | owner | → nothing |
//! | `POST /projects/{id}/hello` | member | [`DeviceHello`] → nothing |
//! | `GET /projects/{id}/peers` | member | → `[`[`PeerInfo`]`]` |
//! | `POST /projects/{id}/changes` | editor | [`PushChanges`] → [`PushResult`] |
//! | `GET /projects/{id}/changes?after=&limit=` | member | → [`ChangePage`] |
//! | `GET /projects/{id}/files` | member | → `[`[`FileNotice`]`]` |
//! | `POST /projects/{id}/files` | editor | [`FileNotice`] → nothing |
//! | `HEAD`/`GET /projects/{id}/blobs/{sha256}` | member | → bytes |
//! | `PUT /projects/{id}/blobs/{sha256}` | editor | bytes → nothing |
//!
//! Errors come back with a 4xx or 5xx status and an [`ApiError`] body. Signed-in requests
//! carry `Authorization: Bearer <token>`.

use kp_store::Change;
use serde::{Deserialize, Serialize};

pub use crate::files::FileNotice;

pub const API: &str = "/api/v1";

/// Project roles, strongest first. Viewers read; editors also send changes and files;
/// owners also manage members.
pub const ROLES: &[&str] = &["owner", "editor", "viewer"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    /// Anyone may create an account (otherwise only people invited to a project, and the
    /// very first user).
    pub open_signup: bool,
    /// No account exists yet: the first one to register becomes the administrator.
    pub first_user: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registration {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub is_admin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub token: String,
    pub user: UserInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    /// The caller's role in it.
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub email: String,
    /// Empty for an invitation nobody has taken up yet.
    pub name: String,
    pub role: String,
    /// Invited by email; becomes a member when that person signs up.
    pub pending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Invitation {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceHello {
    pub device: String,
    pub machine: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerInfo {
    pub device: String,
    pub user: String,
    pub machine: String,
    pub last_seen: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushChanges {
    pub device: String,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushResult {
    pub accepted: usize,
    /// Already on the server (a retried push).
    pub known: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeqChange {
    pub seq: i64,
    pub change: Change,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangePage {
    pub changes: Vec<SeqChange>,
    /// More changes follow; ask again after the last sequence number.
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiError {
    pub error: String,
}

/// A change id or device id as sent by a client: short, plain characters.
pub fn valid_token_text(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A minimal check of an email address: something, an @, something with a dot.
pub fn valid_email(email: &str) -> bool {
    let email = email.trim();
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && email.len() <= 254
        && !email.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_check_catches_the_obvious() {
        assert!(valid_email("ann@firm.co.uk"));
        assert!(valid_email(" ann@firm.com "));
        assert!(!valid_email("ann"));
        assert!(!valid_email("ann@firm"));
        assert!(!valid_email("@firm.com"));
        assert!(!valid_email("ann @firm.com"));
    }

    #[test]
    fn ids_are_plain() {
        assert!(valid_token_text("6afeabc43aaa28c9a8501c4f95b50456"));
        assert!(valid_token_text("web-12-k3j4"));
        assert!(!valid_token_text(""));
        assert!(!valid_token_text("../x"));
        assert!(!valid_token_text(&"a".repeat(65)));
    }
}
