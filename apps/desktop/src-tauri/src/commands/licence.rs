//! Licence key storage and status. The key lives in the user's application data folder,
//! not in any project, and is checked offline with the embedded public key.

use std::{fs, path::PathBuf};

use kp_licence::{LicenceStatus, status, today, verify};
use tauri::{AppHandle, Manager};

const KEY_FILE: &str = "licence.key";

fn key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.join(KEY_FILE))
}

#[tauri::command]
pub fn licence_status(app: AppHandle) -> Result<LicenceStatus, String> {
    let path = key_path(&app)?;
    let key = fs::read_to_string(&path).ok();
    Ok(status(key.as_deref(), &today()))
}

/// Verifies a key and stores it; an invalid or expired key is refused and nothing changes.
#[tauri::command]
pub fn licence_install(app: AppHandle, key: String) -> Result<LicenceStatus, String> {
    let today = today();
    verify(&key, &today).map_err(|e| e.to_string())?;
    let path = key_path(&app)?;
    fs::write(&path, key.trim()).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(status(Some(key.trim()), &today))
}

#[tauri::command]
pub fn licence_remove(app: AppHandle) -> Result<LicenceStatus, String> {
    let path = key_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(LicenceStatus::Evaluation)
}
