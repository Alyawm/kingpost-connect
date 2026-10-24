//! Desktop shell. Wires the Tauri runtime, plugins and the command handlers that the
//! interface calls through `apps/desktop/src/lib/ipc.ts`.

mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::project_is_project,
            commands::project_create,
            commands::project_open,
            commands::project_close,
            commands::project_current,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start KingPost Connect");
}
