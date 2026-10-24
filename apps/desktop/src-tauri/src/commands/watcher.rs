//! Watches the open project folder and tells the interface when files change, so the
//! Explorer refreshes without a manual action. Changes inside `.kingpost/` are the
//! application's own writes and are ignored.

use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "files:changed";
const QUIET_PERIOD: Duration = Duration::from_millis(400);

pub struct FolderWatcher {
    // Dropping the watcher stops the OS subscription; the forwarding thread then ends
    // when the channel closes.
    _watcher: RecommendedWatcher,
}

impl FolderWatcher {
    pub fn start(app: AppHandle, root: &Path) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<PathBuf>();
        let data_dir = root.join(kp_project::DATA_DIR);

        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    for path in event.paths {
                        if !path.starts_with(&data_dir) {
                            let _ = sender.send(path);
                        }
                    }
                }
            })
            .map_err(|e| format!("could not create folder watcher: {e}"))?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| format!("could not watch {}: {e}", root.display()))?;

        // Coalesce bursts (a copy of a large file produces many events) into one message
        // after a quiet period.
        thread::spawn(move || {
            while receiver.recv().is_ok() {
                while receiver.recv_timeout(QUIET_PERIOD).is_ok() {}
                let _ = app.emit(EVENT, ());
            }
        });

        Ok(Self { _watcher: watcher })
    }
}
