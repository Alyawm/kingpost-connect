//! Drawing sets: PDF files as revisions, their sheets, links to the model and markups.
//! The interface renders pages with pdf.js and registers what it read; the shell stores it.

use std::{fs, time::UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::STANDARD};
use kp_store::{
    ElementSheetLink, NewSheet, NewSheetLink, SheetHit, SheetLinkRow, SheetMarkupRow, SheetRow,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use super::{AppState, describe, model::resolve_in_root};

#[derive(Serialize)]
pub struct DrawingImport {
    file_id: i64,
    revision_id: i64,
    revision_index: i64,
    /// The previous revision of the same file, whose links can be carried forward.
    previous_revision_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct SheetInput {
    page: i64,
    number: Option<String>,
    title: Option<String>,
    scale: Option<String>,
    width: f64,
    height: f64,
    text: String,
    /// PNG as a data URL or bare base64.
    thumbnail: Option<String>,
}

/// Records a PDF in the project as a new revision; the interface registers its pages next.
#[tauri::command]
pub fn drawing_import(
    state: State<'_, AppState>,
    rel_path: String,
) -> Result<DrawingImport, String> {
    state.with_project(|project| {
        let path = resolve_in_root(project.root(), &rel_path)?;
        let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let sha256 = super::analysis::hex(&Sha256::digest(&bytes));
        let metadata = fs::metadata(&path).ok();
        let size = metadata.as_ref().map(|m| m.len() as i64);
        let mtime = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());
        let store = project.store();
        let file_id = store
            .upsert_file(&rel_path, "pdf", Some(&sha256), size, mtime.as_deref())
            .map_err(describe)?;
        let previous_revision_id = store
            .revisions(Some(file_id))
            .map_err(describe)?
            .last()
            .map(|r| r.id);
        let (revision_id, revision_index) = store
            .create_revision(file_id, &sha256, Some("PDF"), "{}", None)
            .map_err(describe)?;
        Ok(DrawingImport {
            file_id,
            revision_id,
            revision_index,
            previous_revision_id,
        })
    })
}

/// Stores the pages the interface rendered and, when asked, carries the previous
/// revision's links onto sheets with the same number. Returns the links carried.
#[tauri::command]
pub fn sheets_register(
    state: State<'_, AppState>,
    revision_id: i64,
    sheets: Vec<SheetInput>,
    carry_from_revision_id: Option<i64>,
) -> Result<usize, String> {
    state.with_project(|project| {
        let rows: Vec<NewSheet> = sheets
            .into_iter()
            .map(|s| {
                let thumbnail = s.thumbnail.as_deref().and_then(decode_image);
                NewSheet {
                    page: s.page,
                    number: s.number.filter(|n| !n.trim().is_empty()),
                    title: s.title.filter(|t| !t.trim().is_empty()),
                    scale: s.scale,
                    width: s.width,
                    height: s.height,
                    text: s.text,
                    thumbnail,
                }
            })
            .collect();
        let store = project.store();
        store
            .register_sheets(revision_id, &rows)
            .map_err(describe)?;
        match carry_from_revision_id {
            Some(from) => store
                .carry_links_forward(from, revision_id)
                .map_err(describe),
            None => Ok(0),
        }
    })
}

fn decode_image(data: &str) -> Option<Vec<u8>> {
    let payload = data.split_once(',').map(|(_, b)| b).unwrap_or(data);
    STANDARD.decode(payload.trim()).ok()
}

#[tauri::command]
pub fn sheets_list(
    state: State<'_, AppState>,
    revision_id: Option<i64>,
) -> Result<Vec<SheetRow>, String> {
    state.with_project(|project| project.store().sheets(revision_id).map_err(describe))
}

#[tauri::command]
pub fn sheet_thumbnail(
    state: State<'_, AppState>,
    sheet_id: i64,
) -> Result<Option<String>, String> {
    state.with_project(|project| {
        Ok(project
            .store()
            .sheet_thumbnail(sheet_id)
            .map_err(describe)?
            .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes))))
    })
}

#[tauri::command]
pub fn sheet_update(
    state: State<'_, AppState>,
    sheet_id: i64,
    number: Option<String>,
    title: Option<String>,
    scale: Option<String>,
) -> Result<SheetRow, String> {
    state.with_project(|project| {
        let store = project.store();
        store
            .update_sheet(
                sheet_id,
                number.as_deref(),
                title.as_deref(),
                scale.as_deref(),
            )
            .map_err(describe)?;
        store
            .sheet(sheet_id)
            .map_err(describe)?
            .ok_or_else(|| format!("sheet {sheet_id} does not exist"))
    })
}

#[tauri::command]
pub fn sheets_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SheetHit>, String> {
    state.with_project(|project| {
        project
            .store()
            .search_sheets(&query, limit.unwrap_or(50))
            .map_err(describe)
    })
}

#[tauri::command]
pub fn sheet_links(state: State<'_, AppState>, sheet_id: i64) -> Result<Vec<SheetLinkRow>, String> {
    state.with_project(|project| project.store().sheet_links(sheet_id).map_err(describe))
}

#[tauri::command]
pub fn element_sheet_links(
    state: State<'_, AppState>,
    global_ids: Vec<String>,
) -> Result<Vec<ElementSheetLink>, String> {
    state.with_project(|project| {
        project
            .store()
            .element_sheet_links(&global_ids)
            .map_err(describe)
    })
}

#[tauri::command]
pub fn sheet_link_create(
    state: State<'_, AppState>,
    sheet_id: i64,
    region: serde_json::Value,
    element_global_id: Option<String>,
    view_id: Option<String>,
    label: Option<String>,
    author: Option<String>,
) -> Result<Vec<SheetLinkRow>, String> {
    state.with_project(|project| {
        if element_global_id.is_none() && view_id.is_none() {
            return Err("a link needs an element or a saved view".to_owned());
        }
        let store = project.store();
        let author = super::review::author_or_default(author);
        store
            .insert_sheet_link(&NewSheetLink {
                id: uuid::Uuid::new_v4().to_string(),
                sheet_id,
                region_json: region.to_string(),
                element_global_id,
                view_id,
                label,
                created_by: author,
            })
            .map_err(describe)?;
        store.sheet_links(sheet_id).map_err(describe)
    })
}

#[tauri::command]
pub fn sheet_link_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_sheet_link(&id).map_err(describe))
}

#[tauri::command]
pub fn sheet_markups(
    state: State<'_, AppState>,
    sheet_id: i64,
) -> Result<Vec<SheetMarkupRow>, String> {
    state.with_project(|project| project.store().sheet_markups(sheet_id).map_err(describe))
}

#[tauri::command]
pub fn sheet_markup_add(
    state: State<'_, AppState>,
    sheet_id: i64,
    kind: String,
    geometry: serde_json::Value,
    text: Option<String>,
    author: Option<String>,
) -> Result<Vec<SheetMarkupRow>, String> {
    state.with_project(|project| {
        let store = project.store();
        let author = super::review::author_or_default(author);
        store
            .insert_sheet_markup(
                &uuid::Uuid::new_v4().to_string(),
                sheet_id,
                &author,
                &kind,
                &geometry.to_string(),
                text.as_deref(),
            )
            .map_err(describe)?;
        store.sheet_markups(sheet_id).map_err(describe)
    })
}

#[tauri::command]
pub fn sheet_markup_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_sheet_markup(&id).map_err(describe))
}
