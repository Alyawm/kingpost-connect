//! Notes in the model, links from elements, saving a view image, and opening links.

use std::path::{Path, PathBuf};

use base64::{Engine, engine::general_purpose::STANDARD};
use kp_store::{ElementLinkRow, NoteRow};
use tauri::State;

use super::{AppState, describe, model::resolve_in_root};

#[tauri::command]
pub fn notes_list(state: State<'_, AppState>) -> Result<Vec<NoteRow>, String> {
    state.with_project(|project| project.store().notes().map_err(describe))
}

#[tauri::command]
pub fn note_add(
    state: State<'_, AppState>,
    global_id: Option<String>,
    point: [f64; 3],
    text: String,
    author: String,
) -> Result<Vec<NoteRow>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("a note needs some text".to_owned());
    }
    let point_json = serde_json::to_string(&point).map_err(describe)?;
    state.with_project(|project| {
        let store = project.store();
        store
            .add_note(
                &uuid::Uuid::new_v4().to_string(),
                global_id.as_deref(),
                &point_json,
                text,
                author.trim(),
            )
            .map_err(describe)?;
        store.notes().map_err(describe)
    })
}

#[tauri::command]
pub fn note_update(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<Vec<NoteRow>, String> {
    state.with_project(|project| {
        let store = project.store();
        store.update_note(&id, text.trim()).map_err(describe)?;
        store.notes().map_err(describe)
    })
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, id: String) -> Result<Vec<NoteRow>, String> {
    state.with_project(|project| {
        let store = project.store();
        store.delete_note(&id).map_err(describe)?;
        store.notes().map_err(describe)
    })
}

#[tauri::command]
pub fn element_links(
    state: State<'_, AppState>,
    global_id: Option<String>,
) -> Result<Vec<ElementLinkRow>, String> {
    state.with_project(|project| {
        project
            .store()
            .element_links(global_id.as_deref())
            .map_err(describe)
    })
}

/// A web address, or a file: kept relative when it is inside the project folder.
fn normalise_target(root: &Path, kind: &str, target: &str) -> Result<String, String> {
    let target = target.trim();
    match kind {
        "url" => {
            if target.starts_with("https://") || target.starts_with("http://") {
                Ok(target.to_owned())
            } else {
                Err("a link must start with http:// or https://".to_owned())
            }
        }
        "file" => {
            let path = PathBuf::from(target);
            if path.is_absolute() {
                Ok(path
                    .strip_prefix(root)
                    .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| target.to_owned()))
            } else {
                resolve_in_root(root, target)?;
                Ok(target.replace('\\', "/"))
            }
        }
        _ => Err(format!("unknown link kind {kind}")),
    }
}

#[tauri::command]
pub fn element_link_add(
    state: State<'_, AppState>,
    global_id: String,
    kind: String,
    target: String,
    label: String,
) -> Result<Vec<ElementLinkRow>, String> {
    state.with_project(|project| {
        let target = normalise_target(project.root(), &kind, &target)?;
        let store = project.store();
        store
            .add_element_link(
                &uuid::Uuid::new_v4().to_string(),
                &global_id,
                &kind,
                &target,
                label.trim(),
            )
            .map_err(describe)?;
        store.element_links(Some(&global_id)).map_err(describe)
    })
}

#[tauri::command]
pub fn element_link_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_element_link(&id).map_err(describe))
}

/// Opens a link with the system: a web page in the browser, a file in its application.
#[tauri::command]
pub fn link_open(state: State<'_, AppState>, kind: String, target: String) -> Result<(), String> {
    let resolved = state.with_project(|project| match kind.as_str() {
        "url" => normalise_target(project.root(), "url", &target),
        "file" => {
            let path = PathBuf::from(&target);
            let full = if path.is_absolute() {
                path
            } else {
                resolve_in_root(project.root(), &target)?
            };
            if !full.exists() {
                return Err(format!("{} does not exist", full.display()));
            }
            refuse_programs(&full)?;
            Ok(full.display().to_string())
        }
        _ => Err(format!("unknown link kind {kind}")),
    })?;
    open_with_system(&resolved)
}

/// File types that run code when "opened". A link may point at one (it is just a path),
/// but the application never launches it: links come from colleagues through sync, and a
/// click should never execute a program.
const NOT_OPENED: &[&str] = &[
    "exe", "com", "bat", "cmd", "msi", "msp", "scr", "pif", "cpl", "dll", "sys", "ps1", "psm1",
    "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "jar", "lnk", "url", "reg", "inf", "scf", "sh",
    "command", "app", "desktop", "appimage", "run",
];

fn refuse_programs(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if NOT_OPENED.contains(&extension.as_str()) {
        return Err(format!(
            "{} is a program or script; the application does not open those. Find it in its folder instead.",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn open_with_system(target: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open {target}: {e}"))
}

#[cfg(not(windows))]
fn open_with_system(target: &str) -> Result<(), String> {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open {target}: {e}"))
}

/// Writes an image (data URL or bare base64) chosen in a save dialog, e.g. a view export.
#[tauri::command]
pub fn image_save(path: String, data: String) -> Result<usize, String> {
    let payload = data.split_once(',').map(|(_, d)| d).unwrap_or(&data);
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("image is not valid base64: {e}"))?;
    let target = super::checked_output(&path, &["png", "jpg", "jpeg"])?;
    std::fs::write(&target, &bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_targets_are_checked_and_kept_relative() {
        let root = std::env::temp_dir().join("project");
        assert!(normalise_target(&root, "url", "https://a.b/c").is_ok());
        assert!(normalise_target(&root, "url", "file:///etc/passwd").is_err());
        assert!(normalise_target(&root, "url", "javascript:alert(1)").is_err());
        let inside = root.join("drawings").join("GA.pdf");
        assert_eq!(
            normalise_target(&root, "file", inside.to_str().unwrap()).unwrap(),
            "drawings/GA.pdf"
        );
        assert!(normalise_target(&root, "file", "../outside.pdf").is_err());
        assert!(normalise_target(&root, "zip", "x").is_err());
    }

    #[test]
    fn programs_and_scripts_are_never_launched() {
        assert!(refuse_programs(Path::new("C:/Windows/System32/calc.exe")).is_err());
        assert!(refuse_programs(Path::new("tools/Setup.MSI")).is_err());
        assert!(refuse_programs(Path::new("notes/run.ps1")).is_err());
        assert!(refuse_programs(Path::new("link.lnk")).is_err());
        assert!(refuse_programs(Path::new("drawings/GA.pdf")).is_ok());
        assert!(refuse_programs(Path::new("models/frame.ifc")).is_ok());
        assert!(refuse_programs(Path::new("reports")).is_ok());
    }
}
