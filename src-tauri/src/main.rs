// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Workaround for a blank white window on Linux. WebKitGTK's newer
    // hardware-accelerated DMABUF renderer fails to paint on a number of
    // GPU/driver/compositor combinations (notably KDE Plasma 6 / Wayland on
    // Fedora-atomic distros such as Bazzite, and NVIDIA proprietary drivers),
    // leaving the webview blank. Disabling that renderer forces the reliable
    // fallback path. Must be set before the webview is created — i.e. before
    // run() — and we only override it when the user hasn't set it themselves.
    // See: https://github.com/tauri-apps/tauri/issues/9394
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    ttrpg_cli_ui_lib::run();
}
