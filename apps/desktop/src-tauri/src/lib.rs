//! Desktop shell. Wires the Tauri runtime, plugins and the command handlers that the
//! interface calls through `apps/desktop/src/lib/ipc.ts`.

mod commands;

use commands::{model, project, review, views};

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
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KingPost Connect");
}
