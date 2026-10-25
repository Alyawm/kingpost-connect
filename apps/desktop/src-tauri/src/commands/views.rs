//! Saved views of the open project.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use tauri::State;

use super::{AppState, describe};

#[derive(Serialize, Clone)]
pub struct SavedView {
    id: String,
    name: String,
    camera_json: String,
    visibility_json: String,
    section_planes_json: String,
    /// JPEG as a data URL, when a thumbnail was stored.
    thumbnail: Option<String>,
    created_at: String,
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes))
}

/// Accepts a data URL or bare base64 and returns the image bytes.
fn decode_thumbnail(value: &str) -> Result<Vec<u8>, String> {
    let payload = value.split_once(',').map(|(_, data)| data).unwrap_or(value);
    STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("thumbnail is not valid base64: {e}"))
}

#[tauri::command]
pub fn views_list(state: State<'_, AppState>) -> Result<Vec<SavedView>, String> {
    state.with_project(|project| {
        let store = project.store();
        store
            .saved_views()
            .map_err(describe)?
            .into_iter()
            .map(|row| {
                let thumbnail = if row.has_thumbnail {
                    store
                        .saved_view_thumbnail(&row.id)
                        .map_err(describe)?
                        .map(|b| data_url(&b))
                } else {
                    None
                };
                Ok(SavedView {
                    id: row.id,
                    name: row.name,
                    camera_json: row.camera_json,
                    visibility_json: row.visibility_json,
                    section_planes_json: row.section_planes_json,
                    thumbnail,
                    created_at: row.created_at,
                })
            })
            .collect()
    })
}

#[tauri::command]
pub fn view_save(
    state: State<'_, AppState>,
    name: String,
    camera_json: String,
    visibility_json: String,
    section_planes_json: String,
    thumbnail: Option<String>,
) -> Result<SavedView, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a view needs a name".to_owned());
    }
    let bytes = thumbnail.as_deref().map(decode_thumbnail).transpose()?;
    let id = uuid::Uuid::new_v4().to_string();
    state.with_project(|project| {
        project
            .store()
            .insert_saved_view(
                &id,
                name,
                &camera_json,
                &visibility_json,
                &section_planes_json,
                bytes.as_deref(),
            )
            .map_err(describe)?;
        let row = project
            .store()
            .saved_views()
            .map_err(describe)?
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| "saved view not found after insert".to_owned())?;
        Ok(SavedView {
            id: row.id,
            name: row.name,
            camera_json: row.camera_json,
            visibility_json: row.visibility_json,
            section_planes_json: row.section_planes_json,
            thumbnail: bytes.as_deref().map(data_url),
            created_at: row.created_at,
        })
    })
}

/// Overwrites a view with the current camera, visibility, section and thumbnail.
#[tauri::command]
pub fn view_update(
    state: State<'_, AppState>,
    id: String,
    camera_json: String,
    visibility_json: String,
    section_planes_json: String,
    thumbnail: Option<String>,
) -> Result<bool, String> {
    let bytes = thumbnail.as_deref().map(decode_thumbnail).transpose()?;
    state.with_project(|project| {
        project
            .store()
            .update_saved_view(
                &id,
                &camera_json,
                &visibility_json,
                &section_planes_json,
                bytes.as_deref(),
            )
            .map_err(describe)
    })
}

#[tauri::command]
pub fn view_rename(state: State<'_, AppState>, id: String, name: String) -> Result<bool, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a view needs a name".to_owned());
    }
    state.with_project(|project| {
        project
            .store()
            .rename_saved_view(&id, name)
            .map_err(describe)
    })
}

#[tauri::command]
pub fn view_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_saved_view(&id).map_err(describe))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_data_urls_and_bare_base64() {
        assert_eq!(
            decode_thumbnail("data:image/jpeg;base64,AQID").unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(decode_thumbnail("AQID").unwrap(), vec![1, 2, 3]);
        assert!(decode_thumbnail("not base64!").is_err());
    }
}
