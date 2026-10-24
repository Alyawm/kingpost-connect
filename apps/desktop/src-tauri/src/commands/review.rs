//! Issues, comments, viewpoints, element design status, and BCF exchange.
//!
//! Viewpoint payloads are stored in BCF's own terms (IFC world coordinates, Z up) so that
//! export is a straight mapping; the interface converts to viewer space when applying one.

use std::{collections::HashSet, fs, path::PathBuf};

use base64::{Engine, engine::general_purpose::STANDARD};
use kp_bcf::{BcfFile, Camera, ClippingPlane, Coloring, Extensions, Line, Point, Topic};
use kp_store::{
    CommentRow, IssuePatch, IssueRow, NewIssue, NewViewpoint, STAGES, StatusRow, ViewpointRow,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{AppState, describe};

/// Camera as stored and exchanged: BCF perspective camera in IFC world coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ViewpointCamera {
    pub view_point: [f64; 3],
    pub direction: [f64; 3],
    pub up: [f64; 3],
    pub field_of_view: f64,
    pub aspect_ratio: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ViewpointComponents {
    #[serde(default)]
    pub selection: Vec<String>,
    #[serde(default = "default_true")]
    pub default_visibility: bool,
    #[serde(default)]
    pub exceptions: Vec<String>,
    #[serde(default)]
    pub coloring: Vec<ColoringJson>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColoringJson {
    pub color: String,
    pub ifc_guids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LineJson {
    pub start: [f64; 3],
    pub end: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClippingJson {
    pub location: [f64; 3],
    pub direction: [f64; 3],
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewViewpointInput {
    pub camera: ViewpointCamera,
    #[serde(default)]
    pub components: ViewpointComponents,
    #[serde(default)]
    pub lines: Vec<LineJson>,
    #[serde(default)]
    pub clipping: Vec<ClippingJson>,
    /// JPEG data URL or bare base64.
    pub snapshot: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct IssueDetails {
    issue: IssueRow,
    elements: Vec<String>,
    comments: Vec<CommentRow>,
    viewpoints: Vec<ViewpointRow>,
}

#[derive(Serialize, Clone)]
pub struct BcfImportSummary {
    topics_added: usize,
    topics_skipped: usize,
    comments_added: usize,
    viewpoints_added: usize,
}

pub(crate) fn author_or_default(author: Option<String>) -> String {
    author
        .map(|a| a.trim().to_owned())
        .filter(|a| !a.is_empty())
        .or_else(|| std::env::var("USERNAME").ok())
        .or_else(|| std::env::var("USER").ok())
        .unwrap_or_else(|| "user".to_owned())
}

fn decode_image(value: &str) -> Result<Vec<u8>, String> {
    let payload = value.split_once(',').map(|(_, data)| data).unwrap_or(value);
    STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("snapshot is not valid base64: {e}"))
}

#[tauri::command]
pub fn issues_list(state: State<'_, AppState>) -> Result<Vec<IssueRow>, String> {
    state.with_project(|project| project.store().issues().map_err(describe))
}

#[tauri::command]
pub fn issue_details(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<IssueDetails>, String> {
    state.with_project(|project| {
        let store = project.store();
        let Some(issue) = store.issue(&id).map_err(describe)? else {
            return Ok(None);
        };
        Ok(Some(IssueDetails {
            elements: store.issue_elements(&id).map_err(describe)?,
            comments: store.comments(&id).map_err(describe)?,
            viewpoints: store.viewpoints(&id).map_err(describe)?,
            issue,
        }))
    })
}

#[tauri::command]
pub fn issue_create(
    state: State<'_, AppState>,
    mut issue: NewIssue,
    elements: Vec<String>,
    viewpoint: Option<NewViewpointInput>,
) -> Result<IssueRow, String> {
    if issue.title.trim().is_empty() {
        return Err("an issue needs a title".to_owned());
    }
    issue.created_by = author_or_default(Some(issue.created_by.clone()));
    let id = uuid::Uuid::new_v4().to_string();
    let bcf_guid = uuid::Uuid::new_v4().to_string();
    state.with_project(|project| {
        let store = project.store();
        store
            .insert_issue(&id, &bcf_guid, &issue)
            .map_err(describe)?;
        store.set_issue_elements(&id, &elements).map_err(describe)?;
        if let Some(viewpoint) = viewpoint {
            add_viewpoint(store, &id, &viewpoint)?;
        }
        store
            .issue(&id)
            .map_err(describe)?
            .ok_or_else(|| "issue not found after insert".to_owned())
    })
}

fn add_viewpoint(
    store: &kp_store::Store,
    issue_id: &str,
    input: &NewViewpointInput,
) -> Result<ViewpointRow, String> {
    let snapshot = input.snapshot.as_deref().map(decode_image).transpose()?;
    let id = uuid::Uuid::new_v4().to_string();
    let guid = uuid::Uuid::new_v4().to_string();
    store
        .insert_viewpoint(&NewViewpoint {
            id: &id,
            issue_id,
            guid: &guid,
            camera_json: &serde_json::to_string(&input.camera).map_err(describe)?,
            components_json: &serde_json::to_string(&input.components).map_err(describe)?,
            lines_json: &serde_json::to_string(&input.lines).map_err(describe)?,
            clipping_json: &serde_json::to_string(&input.clipping).map_err(describe)?,
            snapshot: snapshot.as_deref(),
        })
        .map_err(describe)?;
    store
        .viewpoints(issue_id)
        .map_err(describe)?
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| "viewpoint not found after insert".to_owned())
}

#[tauri::command]
pub fn issue_update(
    state: State<'_, AppState>,
    id: String,
    mut patch: IssuePatch,
    author: Option<String>,
) -> Result<Option<IssueRow>, String> {
    patch.modified_by = Some(author_or_default(author));
    state.with_project(|project| {
        let store = project.store();
        if !store.update_issue(&id, &patch).map_err(describe)? {
            return Ok(None);
        }
        store.issue(&id).map_err(describe)
    })
}

#[tauri::command]
pub fn issue_set_elements(
    state: State<'_, AppState>,
    id: String,
    elements: Vec<String>,
) -> Result<(), String> {
    state.with_project(|project| {
        project
            .store()
            .set_issue_elements(&id, &elements)
            .map_err(describe)
    })
}

#[tauri::command]
pub fn issue_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_issue(&id).map_err(describe))
}

#[tauri::command]
pub fn comment_add(
    state: State<'_, AppState>,
    issue_id: String,
    text: String,
    author: Option<String>,
    viewpoint_id: Option<String>,
) -> Result<Vec<CommentRow>, String> {
    if text.trim().is_empty() {
        return Err("a comment needs text".to_owned());
    }
    let author = author_or_default(author);
    let id = uuid::Uuid::new_v4().to_string();
    state.with_project(|project| {
        let store = project.store();
        store
            .insert_comment(
                &id,
                &issue_id,
                &author,
                text.trim(),
                viewpoint_id.as_deref(),
                None,
            )
            .map_err(describe)?;
        store
            .update_issue(
                &issue_id,
                &IssuePatch {
                    modified_by: Some(author.clone()),
                    ..IssuePatch::default()
                },
            )
            .map_err(describe)?;
        store.comments(&issue_id).map_err(describe)
    })
}

#[tauri::command]
pub fn viewpoint_add(
    state: State<'_, AppState>,
    issue_id: String,
    viewpoint: NewViewpointInput,
) -> Result<ViewpointRow, String> {
    state.with_project(|project| add_viewpoint(project.store(), &issue_id, &viewpoint))
}

#[tauri::command]
pub fn viewpoint_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<String>, String> {
    state.with_project(|project| {
        Ok(project
            .store()
            .viewpoint_snapshot(&id)
            .map_err(describe)?
            .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes))))
    })
}

#[tauri::command]
pub fn viewpoint_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.with_project(|project| project.store().delete_viewpoint(&id).map_err(describe))
}

#[tauri::command]
pub fn status_list(state: State<'_, AppState>) -> Result<Vec<StatusRow>, String> {
    state.with_project(|project| project.store().statuses().map_err(describe))
}

#[tauri::command]
pub fn status_set(
    state: State<'_, AppState>,
    global_ids: Vec<String>,
    stage: String,
    author: Option<String>,
    note: Option<String>,
) -> Result<usize, String> {
    if !STAGES.contains(&stage.as_str()) {
        return Err(format!(
            "unknown stage {stage}; expected one of {}",
            STAGES.join(", ")
        ));
    }
    let author = author_or_default(author);
    state.with_project(|project| {
        project
            .store()
            .set_status(&global_ids, &stage, &author, note.as_deref())
            .map_err(describe)
    })
}

#[tauri::command]
pub fn status_clear(state: State<'_, AppState>, global_ids: Vec<String>) -> Result<usize, String> {
    state.with_project(|project| project.store().clear_status(&global_ids).map_err(describe))
}

fn point(a: [f64; 3]) -> Point {
    Point::new(a[0], a[1], a[2])
}

fn triple(p: Point) -> [f64; 3] {
    [p.x, p.y, p.z]
}

/// Writes every issue of the project to a BCF 3.0 file at `path`.
#[tauri::command]
pub fn bcf_export(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let target = PathBuf::from(path);
    let bytes_and_count = state.with_project(|project| {
        let store = project.store();
        let issues = store.issues().map_err(describe)?;
        let mut users: HashSet<String> = HashSet::new();
        let mut topics = Vec::with_capacity(issues.len());
        for issue in &issues {
            users.insert(issue.created_by.clone());
            if let Some(assignee) = &issue.assignee {
                users.insert(assignee.clone());
            }
            let comments = store
                .comments(&issue.id)
                .map_err(describe)?
                .into_iter()
                .map(|c| {
                    users.insert(c.author.clone());
                    kp_bcf::Comment {
                        guid: c.id,
                        date: c.created_at,
                        author: c.author,
                        comment: c.text,
                        viewpoint_guid: c.viewpoint_id,
                        modified_date: None,
                        modified_author: None,
                    }
                })
                .collect();
            let mut viewpoints = Vec::new();
            for (index, row) in store
                .viewpoints(&issue.id)
                .map_err(describe)?
                .into_iter()
                .enumerate()
            {
                let camera: Option<ViewpointCamera> = serde_json::from_str(&row.camera_json).ok();
                let components: ViewpointComponents =
                    serde_json::from_str(&row.components_json).unwrap_or_default();
                let lines: Vec<LineJson> =
                    serde_json::from_str(&row.lines_json).unwrap_or_default();
                let clipping: Vec<ClippingJson> =
                    serde_json::from_str(&row.clipping_json).unwrap_or_default();
                let snapshot = store.viewpoint_snapshot(&row.id).map_err(describe)?;
                viewpoints.push(kp_bcf::Viewpoint {
                    // Comments reference viewpoints by our row id, so that is the exported guid.
                    guid: row.id,
                    index: Some(index as i64),
                    camera: camera.map(|c| Camera::Perspective {
                        view_point: point(c.view_point),
                        direction: point(c.direction),
                        up: point(c.up),
                        field_of_view: c.field_of_view,
                        aspect_ratio: c.aspect_ratio,
                    }),
                    selection: components.selection,
                    default_visibility: components.default_visibility,
                    visibility_exceptions: components.exceptions,
                    coloring: components
                        .coloring
                        .into_iter()
                        .map(|c| Coloring {
                            color: c.color,
                            ifc_guids: c.ifc_guids,
                        })
                        .collect(),
                    lines: lines
                        .into_iter()
                        .map(|l| Line {
                            start: point(l.start),
                            end: point(l.end),
                        })
                        .collect(),
                    clipping_planes: clipping
                        .into_iter()
                        .map(|c| ClippingPlane {
                            location: point(c.location),
                            direction: point(c.direction),
                        })
                        .collect(),
                    snapshot: snapshot.map(|bytes| ("jpg".to_owned(), bytes)),
                });
            }
            topics.push(Topic {
                guid: issue.bcf_guid.clone(),
                topic_type: Some(issue.topic_type.clone()),
                status: Some(issue.status.clone()),
                title: issue.title.clone(),
                priority: issue.priority.clone(),
                index: issue.idx,
                labels: issue.labels.clone(),
                creation_date: issue.created_at.clone(),
                creation_author: issue.created_by.clone(),
                modified_date: issue.modified_at.clone(),
                modified_author: issue.modified_by.clone(),
                due_date: issue.due.clone(),
                assigned_to: issue.assignee.clone(),
                stage: issue.stage.clone(),
                description: issue.description.clone(),
                comments,
                viewpoints,
            });
        }
        let mut topic_types: Vec<String> =
            topics.iter().filter_map(|t| t.topic_type.clone()).collect();
        let mut statuses: Vec<String> = topics.iter().filter_map(|t| t.status.clone()).collect();
        let mut priorities: Vec<String> =
            topics.iter().filter_map(|t| t.priority.clone()).collect();
        let mut labels: Vec<String> = topics.iter().flat_map(|t| t.labels.clone()).collect();
        for list in [
            &mut topic_types,
            &mut statuses,
            &mut priorities,
            &mut labels,
        ] {
            list.sort();
            list.dedup();
        }
        let mut users: Vec<String> = users.into_iter().collect();
        users.sort();
        let file = BcfFile {
            version: "3.0".into(),
            project_name: Some(project.manifest().name.clone()),
            topics,
            extensions: Extensions {
                topic_types,
                topic_statuses: statuses,
                priorities,
                users,
                stages: STAGES.iter().map(|s| (*s).to_owned()).collect(),
                labels,
            },
        };
        let bytes = kp_bcf::write_bcf(&file).map_err(describe)?;
        Ok((bytes, issues.len()))
    })?;
    fs::write(&target, bytes_and_count.0).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(bytes_and_count.1)
}

/// Reads a BCF file and adds the topics that are not already in the project (by guid).
#[tauri::command]
pub fn bcf_import(state: State<'_, AppState>, path: String) -> Result<BcfImportSummary, String> {
    let source = PathBuf::from(path);
    let file = fs::File::open(&source).map_err(|e| format!("{}: {e}", source.display()))?;
    let bcf = kp_bcf::read_bcf(file).map_err(describe)?;
    state.with_project(|project| {
        let store = project.store();
        let mut summary = BcfImportSummary {
            topics_added: 0,
            topics_skipped: 0,
            comments_added: 0,
            viewpoints_added: 0,
        };
        for topic in bcf.topics {
            if topic.guid.is_empty()
                || store
                    .issue_by_guid(&topic.guid)
                    .map_err(describe)?
                    .is_some()
            {
                summary.topics_skipped += 1;
                continue;
            }
            let id = uuid::Uuid::new_v4().to_string();
            let issue = NewIssue {
                title: if topic.title.trim().is_empty() {
                    "(untitled)".into()
                } else {
                    topic.title.clone()
                },
                description: topic.description.clone(),
                topic_type: topic.topic_type.clone(),
                status: topic.status.clone(),
                priority: topic.priority.clone(),
                assignee: topic.assigned_to.clone(),
                due: topic.due_date.clone(),
                labels: topic.labels.clone(),
                stage: topic.stage.clone(),
                created_by: if topic.creation_author.is_empty() {
                    "unknown".into()
                } else {
                    topic.creation_author.clone()
                },
                created_at: (!topic.creation_date.is_empty()).then(|| topic.creation_date.clone()),
                idx: None,
            };
            store
                .insert_issue(&id, &topic.guid, &issue)
                .map_err(describe)?;

            // Elements an issue points at: the union of its viewpoints' selections.
            let mut elements: Vec<String> = topic
                .viewpoints
                .iter()
                .flat_map(|v| v.selection.clone())
                .collect();
            elements.sort();
            elements.dedup();
            store.set_issue_elements(&id, &elements).map_err(describe)?;

            let mut viewpoint_ids: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            for viewpoint in topic.viewpoints {
                let camera = match viewpoint.camera {
                    Some(Camera::Perspective {
                        view_point,
                        direction,
                        up,
                        field_of_view,
                        aspect_ratio,
                    }) => Some(ViewpointCamera {
                        view_point: triple(view_point),
                        direction: triple(direction),
                        up: triple(up),
                        field_of_view,
                        aspect_ratio,
                    }),
                    Some(Camera::Orthogonal {
                        view_point,
                        direction,
                        up,
                        aspect_ratio,
                        ..
                    }) => Some(ViewpointCamera {
                        view_point: triple(view_point),
                        direction: triple(direction),
                        up: triple(up),
                        field_of_view: 50.0,
                        aspect_ratio,
                    }),
                    None => None,
                };
                let Some(camera) = camera else { continue };
                let components = ViewpointComponents {
                    selection: viewpoint.selection,
                    default_visibility: viewpoint.default_visibility,
                    exceptions: viewpoint.visibility_exceptions,
                    coloring: viewpoint
                        .coloring
                        .into_iter()
                        .map(|c| ColoringJson {
                            color: c.color,
                            ifc_guids: c.ifc_guids,
                        })
                        .collect(),
                };
                let lines: Vec<LineJson> = viewpoint
                    .lines
                    .into_iter()
                    .map(|l| LineJson {
                        start: triple(l.start),
                        end: triple(l.end),
                    })
                    .collect();
                let clipping: Vec<ClippingJson> = viewpoint
                    .clipping_planes
                    .into_iter()
                    .map(|c| ClippingJson {
                        location: triple(c.location),
                        direction: triple(c.direction),
                    })
                    .collect();
                let row_id = uuid::Uuid::new_v4().to_string();
                store
                    .insert_viewpoint(&NewViewpoint {
                        id: &row_id,
                        issue_id: &id,
                        guid: &viewpoint.guid,
                        camera_json: &serde_json::to_string(&camera).map_err(describe)?,
                        components_json: &serde_json::to_string(&components).map_err(describe)?,
                        lines_json: &serde_json::to_string(&lines).map_err(describe)?,
                        clipping_json: &serde_json::to_string(&clipping).map_err(describe)?,
                        snapshot: viewpoint
                            .snapshot
                            .as_ref()
                            .map(|(_, bytes)| bytes.as_slice()),
                    })
                    .map_err(describe)?;
                viewpoint_ids.insert(viewpoint.guid, row_id);
                summary.viewpoints_added += 1;
            }

            for comment in topic.comments {
                let comment_id = if comment.guid.is_empty() {
                    uuid::Uuid::new_v4().to_string()
                } else {
                    comment.guid
                };
                let viewpoint_id = comment
                    .viewpoint_guid
                    .as_ref()
                    .and_then(|g| viewpoint_ids.get(g))
                    .cloned();
                store
                    .insert_comment(
                        &comment_id,
                        &id,
                        if comment.author.is_empty() {
                            "unknown"
                        } else {
                            &comment.author
                        },
                        &comment.comment,
                        viewpoint_id.as_deref(),
                        (!comment.date.is_empty()).then_some(comment.date.as_str()),
                    )
                    .map_err(describe)?;
                summary.comments_added += 1;
            }
            summary.topics_added += 1;
        }
        Ok(summary)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn components_default_to_visible() {
        let components: ViewpointComponents = serde_json::from_str("{}").unwrap();
        assert!(components.default_visibility);
        assert!(components.selection.is_empty());
    }

    #[test]
    fn author_falls_back_to_the_login_name() {
        assert_eq!(author_or_default(Some("  maria ".into())), "maria");
        assert!(!author_or_default(Some("   ".into())).is_empty());
    }
}
