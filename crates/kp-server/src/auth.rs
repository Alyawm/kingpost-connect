//! Passwords, session tokens and the signed-in user of a request.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::{ApiErr, AppState};

/// How long a sign-in lasts without use; every use extends it.
pub const SESSION_DAYS: i64 = 90;

/// Argon2id with the crate's defaults (19 MiB, 2 passes): slow enough to make guessing
/// expensive, fast enough for a sign-in.
pub fn hash_password(password: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|e| format!("no randomness: {e}"))?;
    let salt = SaltString::encode_b64(&salt).map_err(|e| e.to_string())?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .and_then(|h| Argon2::default().verify_password(password.as_bytes(), &h))
        .is_ok()
}

/// A hash to check against when the email is unknown, so a wrong email takes as long as
/// a wrong password.
pub(crate) fn dummy_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| hash_password("not a real password").unwrap_or_default())
}

pub(crate) fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Creates a session for `user_id` and returns its token (shown once, stored hashed).
pub(crate) fn create_session(conn: &Connection, user_id: i64) -> Result<String, ApiErr> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| ApiErr::internal())?;
    let token = format!("kp_{}", URL_SAFE_NO_PAD.encode(bytes));
    conn.execute(
        "INSERT INTO session (token_hash, user_id, expires_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3))",
        params![token_hash(&token), user_id, format!("+{SESSION_DAYS} days")],
    )?;
    Ok(token)
}

/// Failed sign-ins per email: after five, each further attempt waits longer (up to a
/// quarter of an hour). Kept in memory; a restart forgets it.
#[derive(Default)]
pub(crate) struct Throttle {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl Throttle {
    const FREE: u32 = 5;

    /// Seconds to wait before another attempt is accepted, if any.
    pub fn wait(&self, email: &str) -> Option<u64> {
        let failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        let (count, last) = failures.get(&email.to_lowercase())?;
        if *count < Self::FREE {
            return None;
        }
        let penalty = Duration::from_secs((15u64 << (count - Self::FREE).min(6)).min(900));
        let elapsed = last.elapsed();
        (elapsed < penalty).then(|| (penalty - elapsed).as_secs().max(1))
    }

    pub fn fail(&self, email: &str) {
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        let entry = failures
            .entry(email.to_lowercase())
            .or_insert((0, Instant::now()));
        entry.0 += 1;
        entry.1 = Instant::now();
    }

    pub fn succeed(&self, email: &str) {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&email.to_lowercase());
    }
}

/// The signed-in user of a request (from `Authorization: Bearer <token>`).
pub(crate) struct Authed {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub is_admin: bool,
    pub token_hash: String,
}

impl FromRequestParts<AppState> for Authed {
    type Rejection = ApiErr;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiErr> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty() && t.len() <= 200)
            .ok_or_else(ApiErr::unauthorized)?;
        let hash = token_hash(token);
        state
            .run(move |conn| {
                let row = conn
                    .query_row(
                        "SELECT u.id, u.email, u.name, u.is_admin FROM session s
                         JOIN user u ON u.id = s.user_id
                         WHERE s.token_hash = ?1
                           AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                        [&hash],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .optional()?;
                let Some((id, email, name, is_admin)) = row else {
                    return Err(ApiErr::unauthorized());
                };
                // Sliding expiry, written at most about once a day.
                conn.execute(
                    "UPDATE session SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)
                     WHERE token_hash = ?1
                       AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3)",
                    params![
                        hash,
                        format!("+{SESSION_DAYS} days"),
                        format!("+{} days", SESSION_DAYS - 1)
                    ],
                )?;
                Ok(Authed {
                    id,
                    email,
                    name,
                    is_admin,
                    token_hash: hash,
                })
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_verify_only_themselves() {
        let hash = hash_password("correct horse battery").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("correct horse battery", &hash));
        assert!(!verify_password("correct horse battery!", &hash));
        assert!(!verify_password("anything", "not a hash"));
    }

    #[test]
    fn repeated_failures_slow_down() {
        let throttle = Throttle::default();
        for _ in 0..5 {
            assert_eq!(throttle.wait("Ann@Firm.com"), None);
            throttle.fail("ann@firm.com");
        }
        assert!(throttle.wait("ANN@firm.com").is_some());
        throttle.succeed("ann@firm.com");
        assert_eq!(throttle.wait("ann@firm.com"), None);
    }
}
