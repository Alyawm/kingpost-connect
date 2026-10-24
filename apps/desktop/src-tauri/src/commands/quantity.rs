//! Quantity schedules: built-in and saved definitions, evaluation over a revision,
//! geometry quantities measured by the interface, material densities, and exports.

use std::path::PathBuf;

use kp_quantity::{Definition, Table, export, presets};
use kp_store::{CatalogueEntry, DensityRow, GeometryQuantity, PresetRow};
use serde::Serialize;
use tauri::State;

use super::{AppState, describe};

const PRESET_KIND: &str = "schedule";

#[derive(Serialize)]
pub struct SchedulePresets {
    builtin: Vec<Definition>,
    saved: Vec<PresetRow>,
}

#[tauri::command]
pub fn schedule_presets(state: State<'_, AppState>) -> Result<SchedulePresets, String> {
    state.with_project(|project| {
        Ok(SchedulePresets {
            builtin: presets::builtin(),
            saved: project.store().presets(PRESET_KIND).map_err(describe)?,
        })
    })
}

#[tauri::command]
pub fn schedule_save(
    state: State<'_, AppState>,
    id: Option<String>,
    definition: Definition,
) -> Result<PresetRow, String> {
    state.with_project(|project| {
        let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let json = serde_json::to_string(&definition).map_err(describe)?;
        let store = project.store();
        store
            .save_preset(&id, "project", PRESET_KIND, &definition.name, &json)
            .map_err(describe)?;
        store
            .presets(PRESET_KIND)
            .map_err(describe)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "preset was not stored".to_owned())
    })
}

#[tauri::command]
pub fn schedule_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_preset(&id).map_err(describe))
}

/// Evaluates a definition over a revision on a worker thread.
#[tauri::command]
pub async fn schedule_evaluate(
    state: State<'_, AppState>,
    revision_id: i64,
    definition: Definition,
) -> Result<Table, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with_project(|project| {
            kp_quantity::evaluate(project.store(), revision_id, &definition).map_err(describe)
        })
    })
    .await
    .map_err(|e| format!("schedule thread failed: {e}"))?
}

/// Writes the evaluated table as CSV or XLSX, by the path's extension.
#[tauri::command]
pub fn schedule_export(
    state: State<'_, AppState>,
    revision_id: i64,
    definition: Definition,
    path: String,
) -> Result<usize, String> {
    state.with_project(|project| {
        let table = kp_quantity::evaluate(project.store(), revision_id, &definition).map_err(describe)?;
        let target = PathBuf::from(&path);
        let is_xlsx = target
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("xlsx"));
        if is_xlsx {
            export::write_xlsx(&table, &target).map_err(describe)?;
        } else {
            std::fs::write(&target, export::to_csv(&table))
                .map_err(|e| format!("{}: {e}", target.display()))?;
        }
        Ok(table.rows.len())
    })
}

#[tauri::command]
pub fn property_catalogue(state: State<'_, AppState>, revision_id: i64) -> Result<Vec<CatalogueEntry>, String> {
    state.with_project(|project| project.store().property_catalogue(revision_id).map_err(describe))
}

#[tauri::command]
pub fn geometry_quantity_count(state: State<'_, AppState>, revision_id: i64) -> Result<i64, String> {
    state.with_project(|project| project.store().geometry_quantity_count(revision_id).map_err(describe))
}

#[tauri::command]
pub fn geometry_quantities_save(
    state: State<'_, AppState>,
    revision_id: i64,
    rows: Vec<GeometryQuantity>,
) -> Result<usize, String> {
    state.with_project(|project| {
        project
            .store()
            .save_geometry_quantities(revision_id, &rows)
            .map_err(describe)
    })
}

#[tauri::command]
pub fn densities(state: State<'_, AppState>) -> Result<Vec<DensityRow>, String> {
    state.with_project(|project| project.store().densities().map_err(describe))
}

#[tauri::command]
pub fn density_set(
    state: State<'_, AppState>,
    material: String,
    density: f64,
    note: Option<String>,
) -> Result<Vec<DensityRow>, String> {
    state.with_project(|project| {
        let material = material.trim();
        if material.is_empty() || !(density > 0.0) {
            return Err("a material name and a positive density are needed".to_owned());
        }
        let store = project.store();
        store.set_density(material, density, note.as_deref()).map_err(describe)?;
        store.densities().map_err(describe)
    })
}

#[tauri::command]
pub fn density_remove(state: State<'_, AppState>, material: String) -> Result<Vec<DensityRow>, String> {
    state.with_project(|project| {
        let store = project.store();
        store.remove_density(&material).map_err(describe)?;
        store.densities().map_err(describe)
    })
}
