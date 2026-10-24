//! Licence keys that work without a network.
//!
//! A key is `KPC1.<payload>.<signature>`: a base64url JSON payload (who it is for, what
//! edition, when it expires, how many seats) signed with Ed25519 by the issuer's private
//! key. The application carries only the public key, so a key can be checked anywhere,
//! any time, and nothing phones home. The private key never enters this repository;
//! `examples/licence_tool.rs` generates and uses it.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const KEY_PREFIX: &str = "KPC1";

/// The issuer's public key (32 bytes, base64url). Replace when the key pair is rotated:
/// keys issued with the old private key stop validating.
pub const PUBLIC_KEY: &str = "EnRt6-z9BU-8DAFeGGeo0RBVg9O7nRqApdQfslAHtds";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Licence {
    /// Licensee: a person or an organisation.
    pub name: String,
    pub organisation: Option<String>,
    /// `standard` for now; room for editions later.
    pub edition: String,
    pub seats: u32,
    /// Issue and expiry as `YYYY-MM-DD` (UTC). `None` never expires.
    pub issued: String,
    pub expires: Option<String>,
    /// Issuer's reference, for support.
    pub reference: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LicenceError {
    #[error("not a licence key")]
    Format,
    #[error("the licence payload is not readable")]
    Payload,
    #[error("the signature does not match this application's issuer")]
    Signature,
    #[error("the licence expired on {0}")]
    Expired(String),
    #[error("the issuer key is not configured")]
    NoIssuerKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum LicenceStatus {
    /// No key installed: the application runs as an evaluation copy.
    Evaluation,
    Valid {
        licence: Licence,
        /// Days until expiry, when it expires.
        days_left: Option<i64>,
    },
    Expired {
        licence: Licence,
    },
    Invalid {
        reason: String,
    },
}

/// Checks a key against `PUBLIC_KEY` as of `today` (`YYYY-MM-DD`).
pub fn verify(key: &str, today: &str) -> Result<Licence, LicenceError> {
    verify_with(key, today, PUBLIC_KEY)
}

pub fn verify_with(key: &str, today: &str, public_key: &str) -> Result<Licence, LicenceError> {
    let mut parts = key.trim().split('.');
    let (Some(prefix), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(LicenceError::Format);
    };
    if prefix != KEY_PREFIX {
        return Err(LicenceError::Format);
    }
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| LicenceError::Format)?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| LicenceError::Format)?;
    let verifying = verifying_key(public_key)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| LicenceError::Signature)?;
    verifying
        .verify(&payload_bytes, &signature)
        .map_err(|_| LicenceError::Signature)?;
    let licence: Licence =
        serde_json::from_slice(&payload_bytes).map_err(|_| LicenceError::Payload)?;
    if let Some(expires) = &licence.expires
        && expires.as_str() < today
    {
        return Err(LicenceError::Expired(expires.clone()));
    }
    Ok(licence)
}

/// Status for the interface: never fails, says what it found.
pub fn status(key: Option<&str>, today: &str) -> LicenceStatus {
    let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) else {
        return LicenceStatus::Evaluation;
    };
    match verify(key, today) {
        Ok(licence) => {
            let days_left = licence
                .expires
                .as_deref()
                .and_then(|e| days_between(today, e));
            LicenceStatus::Valid { licence, days_left }
        }
        Err(LicenceError::Expired(_)) => match payload_of(key) {
            Some(licence) => LicenceStatus::Expired { licence },
            None => LicenceStatus::Invalid {
                reason: LicenceError::Payload.to_string(),
            },
        },
        Err(error) => LicenceStatus::Invalid {
            reason: error.to_string(),
        },
    }
}

/// Signs a licence with the issuer's private key (32 bytes, base64url).
pub fn issue(licence: &Licence, private_key: &str) -> Result<String, LicenceError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(private_key.trim())
        .map_err(|_| LicenceError::NoIssuerKey)?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| LicenceError::NoIssuerKey)?;
    let signing = SigningKey::from_bytes(&bytes);
    let payload = serde_json::to_vec(licence).map_err(|_| LicenceError::Payload)?;
    let signature = signing.sign(&payload);
    Ok(format!(
        "{KEY_PREFIX}.{}.{}",
        URL_SAFE_NO_PAD.encode(payload),
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}

/// A fresh key pair as (private, public), both base64url.
pub fn generate_key_pair() -> (String, String) {
    let signing = SigningKey::generate(&mut rand_core::OsRng);
    (
        URL_SAFE_NO_PAD.encode(signing.to_bytes()),
        URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes()),
    )
}

fn verifying_key(public_key: &str) -> Result<VerifyingKey, LicenceError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(public_key.trim())
        .map_err(|_| LicenceError::NoIssuerKey)?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| LicenceError::NoIssuerKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| LicenceError::NoIssuerKey)
}

fn payload_of(key: &str) -> Option<Licence> {
    let payload = key.trim().split('.').nth(1)?;
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
}

/// Whole days from `from` to `to` (`YYYY-MM-DD`), negative when `to` is earlier.
pub fn days_between(from: &str, to: &str) -> Option<i64> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    let a = time::Date::parse(from, &format).ok()?;
    let b = time::Date::parse(to, &format).ok()?;
    Some((b - a).whole_days())
}

/// Today's date as `YYYY-MM-DD` (UTC).
pub fn today() -> String {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    time::OffsetDateTime::now_utc()
        .date()
        .format(&format)
        .unwrap_or_else(|_| "1970-01-01".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn licence(expires: Option<&str>) -> Licence {
        Licence {
            name: "Maria Example".into(),
            organisation: Some("Example Engineers".into()),
            edition: "standard".into(),
            seats: 5,
            issued: "2026-10-24".into(),
            expires: expires.map(str::to_owned),
            reference: "INV-1001".into(),
        }
    }

    #[test]
    fn issued_keys_verify_with_the_matching_public_key_only() {
        let (private, public) = generate_key_pair();
        let key = issue(&licence(Some("2027-10-24")), &private).unwrap();
        assert!(key.starts_with("KPC1."));
        let verified = verify_with(&key, "2026-11-01", &public).unwrap();
        assert_eq!(verified.name, "Maria Example");
        assert_eq!(verified.seats, 5);

        let (_, other_public) = generate_key_pair();
        assert_eq!(
            verify_with(&key, "2026-11-01", &other_public),
            Err(LicenceError::Signature)
        );
        assert_eq!(
            verify_with(&key, "2027-10-25", &public),
            Err(LicenceError::Expired("2027-10-24".into()))
        );
        let tampered = key.replace("KPC1.", "KPC1.x");
        assert!(matches!(
            verify_with(&tampered, "2026-11-01", &public),
            Err(LicenceError::Signature) | Err(LicenceError::Format)
        ));
        assert_eq!(
            verify_with("hello", "2026-11-01", &public),
            Err(LicenceError::Format)
        );
    }

    #[test]
    fn perpetual_keys_never_expire_and_days_count_down() {
        let (private, public) = generate_key_pair();
        let key = issue(&licence(None), &private).unwrap();
        assert!(verify_with(&key, "2099-01-01", &public).is_ok());
        assert_eq!(days_between("2026-10-24", "2026-11-03"), Some(10));
        assert_eq!(days_between("2026-10-24", "2026-10-20"), Some(-4));
        assert_eq!(days_between("nonsense", "2026-10-20"), None);
    }

    #[test]
    fn status_reports_evaluation_without_a_key() {
        assert_eq!(status(None, "2026-10-24"), LicenceStatus::Evaluation);
        assert_eq!(status(Some("  "), "2026-10-24"), LicenceStatus::Evaluation);
        assert!(matches!(
            status(Some("junk"), "2026-10-24"),
            LicenceStatus::Invalid { .. }
        ));
    }
}
