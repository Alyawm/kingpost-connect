//! Desktop shell. Wires the Tauri runtime, plugins and the command handlers that the
//! interface calls through `apps/desktop/src/lib/ipc.ts`.

mod commands;

use commands::{model, project};

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
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KingPost Connect");
}
