//! Desktop shell. Wires the Tauri runtime, plugins and the command handlers that the
//! interface calls through `apps/desktop/src/lib/ipc.ts`.

mod commands;

use commands::{analysis, compare, drawings, model, project, review, views};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::from_environment())
        .invoke_handler(tauri::generate_handler![
            project::app_info,
            project::project_is_project,
            project::project_create,
            project::project_open,
            project::project_close,
            project::project_current,
            model::project_files,
            model::import_ifc,
            model::read_project_file,
            model::revision_info,
            model::revision_elements,
            model::element_details,
            model::search_elements,
            views::views_list,
            views::view_save,
            views::view_rename,
            views::view_delete,
            review::issues_list,
            review::issue_details,
            review::issue_create,
            review::issue_update,
            review::issue_set_elements,
            review::issue_delete,
            review::comment_add,
            review::viewpoint_add,
            review::viewpoint_snapshot,
            review::viewpoint_delete,
            review::status_list,
            review::status_set,
            review::status_clear,
            review::bcf_export,
            review::bcf_import,
            compare::diff_revisions,
            compare::diff_export_csv,
            analysis::analysis_import,
            analysis::analysis_models,
            analysis::analysis_model,
            analysis::analysis_match,
            analysis::analysis_link_set,
            analysis::analysis_link_override,
            drawings::drawing_import,
            drawings::sheets_register,
            drawings::sheets_list,
            drawings::sheet_thumbnail,
            drawings::sheet_update,
            drawings::sheets_search,
            drawings::sheet_links,
            drawings::element_sheet_links,
            drawings::sheet_link_create,
            drawings::sheet_link_delete,
            drawings::sheet_markups,
            drawings::sheet_markup_add,
            drawings::sheet_markup_delete,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KingPost Connect");
}
