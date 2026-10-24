//! Clash tests: the interface finds clashes on the loaded meshes; the shell keeps the
//! tests, the clashes and their statuses across runs and revisions.

use kp_store::{ClashFound, ClashRow, ClashTestRow, RunSummary};
use tauri::State;

use super::{AppState, describe};

#[tauri::command]
pub fn clash_tests(state: State<'_, AppState>) -> Result<Vec<ClashTestRow>, String> {
    state.with_project(|project| project.store().clash_tests().map_err(describe))
}

#[tauri::command]
pub fn clash_test_create(
    state: State<'_, AppState>,
    name: String,
    kind: String,
    clearance: f64,
    set_a: Vec<String>,
    set_b: Vec<String>,
) -> Result<ClashTestRow, String> {
    state.with_project(|project| {
        let name = name.trim();
        if name.is_empty() {
            return Err("a clash test needs a name".to_owned());
        }
        if set_a.is_empty() || set_b.is_empty() {
            return Err("both sets need at least one element".to_owned());
        }
        if kind != "hard" && kind != "clearance" {
            return Err(format!("unknown clash test kind {kind}"));
        }
        project
            .store()
            .create_clash_test(
                &uuid::Uuid::new_v4().to_string(),
                name,
                &kind,
                if kind == "hard" {
                    0.0
                } else {
                    clearance.max(0.0)
                },
                &set_a,
                &set_b,
            )
            .map_err(describe)
    })
}

#[tauri::command]
pub fn clash_test_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_clash_test(&id).map_err(describe))
}

/// Stores what a run found and returns how the clash list changed.
#[tauri::command]
pub fn clash_run_record(
    state: State<'_, AppState>,
    test_id: String,
    revision_id: Option<i64>,
    found: Vec<ClashFound>,
) -> Result<RunSummary, String> {
    state.with_project(|project| {
        project
            .store()
            .record_clash_run(&test_id, revision_id, &found, || {
                uuid::Uuid::new_v4().to_string()
            })
            .map_err(describe)
    })
}

#[tauri::command]
pub fn clash_list(state: State<'_, AppState>, test_id: String) -> Result<Vec<ClashRow>, String> {
    state.with_project(|project| project.store().clashes(&test_id).map_err(describe))
}

#[tauri::command]
pub fn clash_set_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
    note: Option<String>,
) -> Result<bool, String> {
    state.with_project(|project| {
        project
            .store()
            .set_clash_status(&id, &status, note.as_deref())
            .map_err(describe)
    })
}
