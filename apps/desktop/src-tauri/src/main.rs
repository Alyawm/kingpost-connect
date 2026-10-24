// Release builds run without a console window; debug builds keep it for log output.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kingpost_connect_lib::run()
}
