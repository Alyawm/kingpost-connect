//! Local diagnostics: a session log file in the project's data directory and a bundle the
//! user can send when something goes wrong. Nothing leaves the machine on its own.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use serde::Serialize;
use tauri::State;
use zip::{ZipWriter, write::SimpleFileOptions};

use super::{AppState, describe};

const LOG_DIR: &str = "logs";
const KEEP_LOGS: usize = 10;

#[derive(Serialize)]
pub struct BundleSummary {
    path: String,
    files: usize,
    bytes: u64,
}

fn log_dir(project: &kp_project::Project) -> PathBuf {
    project.data_dir().join(LOG_DIR)
}

fn session_log(project: &kp_project::Project) -> PathBuf {
    let stamp = time::OffsetDateTime::now_utc()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap_or_else(|_| "session".into());
    log_dir(project).join(format!("{stamp}.log"))
}

/// Appends interface log lines to today's log file of the open project.
#[tauri::command]
pub fn log_append(state: State<'_, AppState>, lines: Vec<String>) -> Result<(), String> {
    state.with_project(|project| {
        let dir = log_dir(project);
        fs::create_dir_all(&dir).map_err(describe)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(session_log(project))
            .map_err(describe)?;
        for line in lines {
            writeln!(file, "{line}").map_err(describe)?;
        }
        prune(&dir);
        Ok(())
    })
}

/// Keeps the newest log files only.
fn prune(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut logs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "log"))
        .collect();
    logs.sort();
    while logs.len() > KEEP_LOGS {
        let oldest = logs.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

/// Writes a zip with the logs, the project manifest, the schema version and the
/// application and system details to `path`.
#[tauri::command]
pub fn diagnostics_bundle(
    state: State<'_, AppState>,
    path: String,
) -> Result<BundleSummary, String> {
    state.with_project(|project| {
        let target = PathBuf::from(&path);
        let file = fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut files = 0;

        let about = format!(
            "application: KingPost Connect {}\nos: {} {}\narchitecture: {}\nproject: {} ({})\nschema version: {}\nwritten: {}\n",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            os_version(),
            std::env::consts::ARCH,
            project.manifest().name,
            project.root().display(),
            project.store().schema_version().map_err(describe)?,
            time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        );
        zip.start_file("about.txt", options).map_err(describe)?;
        zip.write_all(about.as_bytes()).map_err(describe)?;
        files += 1;

        let manifest = project.data_dir().join(kp_project::MANIFEST_FILE);
        if let Ok(bytes) = fs::read(&manifest) {
            zip.start_file("project.json", options).map_err(describe)?;
            zip.write_all(&bytes).map_err(describe)?;
            files += 1;
        }
        if let Ok(entries) = fs::read_dir(log_dir(project)) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.extension().is_some_and(|e| e == "log")
                    && let Ok(bytes) = fs::read(&p)
                {
                    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    zip.start_file(format!("logs/{name}"), options).map_err(describe)?;
                    zip.write_all(&bytes).map_err(describe)?;
                    files += 1;
                }
            }
        }
        zip.finish().map_err(describe)?;
        let bytes = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        Ok(BundleSummary {
            path: target.display().to_string(),
            files,
            bytes,
        })
    })
}

fn os_version() -> String {
    // Keep it simple and dependency-free: the kernel family is enough for support.
    std::env::var("OS").unwrap_or_default()
}
