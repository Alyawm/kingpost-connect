//! Analysis models: import SAF / ETABS / SAP2000 files, hand the stored model to the
//! viewer, and match it against the physical model.

use std::{path::Path, time::Instant};

use kp_analysis::{AnalysisModel, LinkReport, MatchSettings, PhysicalAxis, Summary};
use kp_store::{AnalysisModelRow, AnalysisModelSummary, Store};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use super::{AppState, describe};

#[derive(Serialize)]
pub struct AnalysisImportSummary {
    file_id: i64,
    revision_id: i64,
    revision_index: i64,
    summary: Summary,
    total_ms: u64,
}

#[derive(Serialize)]
pub struct LinkSetView {
    computed_at: String,
    settings: MatchSettings,
    report: LinkReport,
}

/// Stores a parsed model as an analysis revision of `rel_path`.
pub fn store_model(
    store: &Store,
    rel_path: &str,
    kind: &str,
    bytes: &[u8],
    path: &Path,
    model: &AnalysisModel,
) -> Result<(i64, i64, i64), String> {
    let sha256 = hex(&Sha256::digest(bytes));
    let metadata = std::fs::metadata(path).ok();
    let size = metadata.as_ref().map(|m| m.len() as i64);
    let mtime = metadata
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string());
    let file_id = store
        .upsert_file(rel_path, kind, Some(&sha256), size, mtime.as_deref())
        .map_err(describe)?;
    let units_json = serde_json::to_string(&model.units).map_err(describe)?;
    let (revision_id, idx) = store
        .create_revision(
            file_id,
            &sha256,
            model.program.as_deref(),
            &units_json,
            None,
        )
        .map_err(describe)?;
    save_model(store, revision_id, model)?;
    Ok((file_id, revision_id, idx))
}

/// Attaches a model to an existing revision (the structural view of an imported IFC).
pub fn save_model(store: &Store, revision_id: i64, model: &AnalysisModel) -> Result<(), String> {
    let row = AnalysisModelRow {
        source: model.source.clone(),
        program: model.program.clone(),
        length_unit: model.units.length.clone(),
        force_unit: model.units.force.clone(),
        node_count: model.nodes.len() as i64,
        member_count: model.members.len() as i64,
        surface_count: model.surfaces.len() as i64,
        load_count: model.load_count() as i64,
        result_count: model.results.len() as i64,
        model_json: serde_json::to_string(model).map_err(describe)?,
    };
    store
        .save_analysis_model(revision_id, &row)
        .map_err(describe)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_model(store: &Store, revision_id: i64) -> Result<AnalysisModel, String> {
    let json = store
        .analysis_model_json(revision_id)
        .map_err(describe)?
        .ok_or_else(|| format!("revision {revision_id} has no analysis model"))?;
    serde_json::from_str(&json).map_err(describe)
}

/// Reads an analysis file in the project and stores it as a new revision of that file.
#[tauri::command]
pub async fn analysis_import(
    state: State<'_, AppState>,
    rel_path: String,
) -> Result<AnalysisImportSummary, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with_project(|project| {
            let started = Instant::now();
            let path = super::model::resolve_in_root(project.root(), &rel_path)?;
            let kind = kp_analysis::kind_of(&path).ok_or_else(|| {
                format!("{rel_path} is not an analysis file (SAF .xlsx, .e2k or .s2k)")
            })?;
            if kind == "ifc" {
                return Err(
                    "import the IFC file itself; its structural view is read with it".to_owned(),
                );
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let model = kp_analysis::read_bytes(kind, &bytes).map_err(describe)?;
            let (file_id, revision_id, revision_index) =
                store_model(project.store(), &rel_path, kind, &bytes, &path, &model)?;
            Ok(AnalysisImportSummary {
                file_id,
                revision_id,
                revision_index,
                summary: Summary::of(&model),
                total_ms: started.elapsed().as_millis() as u64,
            })
        })
    })
    .await
    .map_err(|e| format!("import thread failed: {e}"))?
}

#[tauri::command]
pub fn analysis_models(state: State<'_, AppState>) -> Result<Vec<AnalysisModelSummary>, String> {
    state.with_project(|project| project.store().analysis_models().map_err(describe))
}

/// The stored model as JSON text; the interface parses it.
#[tauri::command]
pub fn analysis_model(state: State<'_, AppState>, revision_id: i64) -> Result<String, String> {
    state.with_project(|project| {
        project
            .store()
            .analysis_model_json(revision_id)
            .map_err(describe)?
            .ok_or_else(|| format!("revision {revision_id} has no analysis model"))
    })
}

/// Matches the physical axes against the analysis model and stores the report.
#[tauri::command]
pub async fn analysis_match(
    state: State<'_, AppState>,
    physical_revision_id: i64,
    analysis_revision_id: i64,
    axes: Vec<PhysicalAxis>,
    settings: MatchSettings,
) -> Result<LinkSetView, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with_project(|project| {
            let store = project.store();
            let model = load_model(store, analysis_revision_id)?;
            let report = kp_analysis::match_members(&model, &axes, &settings);
            let row = store
                .save_link_set(
                    physical_revision_id,
                    analysis_revision_id,
                    &serde_json::to_string(&settings).map_err(describe)?,
                    &serde_json::to_string(&report).map_err(describe)?,
                )
                .map_err(describe)?;
            Ok(LinkSetView {
                computed_at: row.computed_at,
                settings,
                report,
            })
        })
    })
    .await
    .map_err(|e| format!("matching thread failed: {e}"))?
}

#[tauri::command]
pub fn analysis_link_set(
    state: State<'_, AppState>,
    physical_revision_id: i64,
    analysis_revision_id: i64,
) -> Result<Option<LinkSetView>, String> {
    state.with_project(|project| {
        let Some(row) = project
            .store()
            .link_set(physical_revision_id, analysis_revision_id)
            .map_err(describe)?
        else {
            return Ok(None);
        };
        Ok(Some(LinkSetView {
            computed_at: row.computed_at,
            settings: serde_json::from_str(&row.settings_json).map_err(describe)?,
            report: serde_json::from_str(&row.report_json).map_err(describe)?,
        }))
    })
}

/// Links one element to a member by hand (or unlinks it with `member_uid` absent).
#[tauri::command]
pub fn analysis_link_override(
    state: State<'_, AppState>,
    physical_revision_id: i64,
    analysis_revision_id: i64,
    global_id: String,
    member_uid: Option<String>,
    axis: Option<PhysicalAxis>,
) -> Result<LinkReport, String> {
    state.with_project(|project| {
        let store = project.store();
        let row = store
            .link_set(physical_revision_id, analysis_revision_id)
            .map_err(describe)?
            .ok_or_else(|| "run the automatic matching before linking by hand".to_owned())?;
        let model = load_model(store, analysis_revision_id)?;
        let mut report: LinkReport = serde_json::from_str(&row.report_json).map_err(describe)?;
        if member_uid.is_some() && model.member(member_uid.as_deref().unwrap_or("")).is_none() {
            return Err(format!(
                "member {} is not in the analysis model",
                member_uid.unwrap_or_default()
            ));
        }
        report.set_manual(&model, axis.as_ref(), &global_id, member_uid.as_deref());
        if !report.unmatched_physical.contains(&global_id) && report.link_for(&global_id).is_none()
        {
            report.unmatched_physical.push(global_id.clone());
        }
        store
            .update_link_report(row.id, &serde_json::to_string(&report).map_err(describe)?)
            .map_err(describe)?;
        Ok(report)
    })
}
