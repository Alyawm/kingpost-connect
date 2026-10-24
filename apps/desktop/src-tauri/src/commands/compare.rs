//! Revision comparison: compute or reuse a diff between two revisions, list it, export it.

use std::{fs, path::PathBuf};

use kp_diff::{Diff, DiffItem, Summary};
use serde::Serialize;
use tauri::State;

use super::{AppState, describe};

#[derive(Serialize, Clone)]
pub struct DiffView {
    id: i64,
    from_revision_id: i64,
    to_revision_id: i64,
    computed_at: String,
    cached: bool,
    summary: Summary,
    items: Vec<DiffItem>,
}

fn load_or_compute(
    store: &kp_store::Store,
    from_revision_id: i64,
    to_revision_id: i64,
    force: bool,
) -> Result<(i64, String, bool, Diff), String> {
    if !force
        && let Some(existing) = store
            .find_diff(from_revision_id, to_revision_id)
            .map_err(describe)?
    {
        let diff = kp_diff::load(store, existing.id, &existing.summary_json).map_err(describe)?;
        return Ok((existing.id, existing.computed_at, true, diff));
    }
    let diff = kp_diff::compare(store, from_revision_id, to_revision_id).map_err(describe)?;
    let id = kp_diff::save(store, from_revision_id, to_revision_id, &diff).map_err(describe)?;
    let computed_at = store
        .find_diff(from_revision_id, to_revision_id)
        .map_err(describe)?
        .map(|r| r.computed_at)
        .unwrap_or_default();
    Ok((id, computed_at, false, diff))
}

/// Compares two revisions; a stored result is reused unless `force` is set.
/// Runs on a worker thread because large revisions take a few seconds.
#[tauri::command]
pub async fn diff_revisions(
    state: State<'_, AppState>,
    from_revision_id: i64,
    to_revision_id: i64,
    force: Option<bool>,
) -> Result<DiffView, String> {
    if from_revision_id == to_revision_id {
        return Err("choose two different revisions".to_owned());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with_project(|project| {
            let (id, computed_at, cached, diff) = load_or_compute(
                project.store(),
                from_revision_id,
                to_revision_id,
                force.unwrap_or(false),
            )?;
            Ok(DiffView {
                id,
                from_revision_id,
                to_revision_id,
                computed_at,
                cached,
                summary: diff.summary,
                items: diff.items,
            })
        })
    })
    .await
    .map_err(|e| format!("comparison thread failed: {e}"))?
}

/// Writes a stored diff as CSV; returns the number of changed elements written.
#[tauri::command]
pub fn diff_export_csv(
    state: State<'_, AppState>,
    from_revision_id: i64,
    to_revision_id: i64,
    path: String,
) -> Result<usize, String> {
    let target = PathBuf::from(path);
    let (csv, count) = state.with_project(|project| {
        let (_, _, _, diff) =
            load_or_compute(project.store(), from_revision_id, to_revision_id, false)?;
        Ok((kp_diff::to_csv(&diff), diff.items.len()))
    })?;
    fs::write(&target, csv).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(count)
}
