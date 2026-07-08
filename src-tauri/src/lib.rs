// lib.rs — Tauri v2 backend.
//
// The frontend handles HTTP (release lookup), git spawning, and dialogs via
// plugins. Rust owns the jobs JS handles poorly or is scope-blocked from:
//   detect_host       — OS + CPU arch.
//   download_extract  — download a .zip/.tar.gz and unpack it (generic).
//   install_cli       — download_extract + locate the converter + chmod.
//   run_converter     — spawn the converter, stream output.
//   write_text_file   — write a file anywhere (config saving; not scope-bound).
//   read_text_file    — read a file anywhere (load an existing config).
//   list_files        — list files by extension in a dir (templates, configs).
//   path_exists       — check a path (verify a remembered install still exists).
//
// std::fs is NOT subject to the JS fs-plugin scope, so these work on any drive
// (e.g. D:\), which is where the scope-based approach was failing.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct HostInfo {
    os: String,   // "windows" | "macos" | "linux"
    arch: String, // "x64" | "arm64"
}

#[tauri::command]
fn detect_host() -> HostInfo {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    HostInfo { os: os.to_string(), arch: host_arch().to_string() }
}

/// Detect the host CPU architecture. `cfg!(target_arch)` only tells us what the
/// app was *compiled* for, which is wrong when an x86_64 build runs on Apple
/// Silicon under Rosetta. On macOS we additionally check `sysctl.proc_translated`
/// — a value of 1 means we're being translated, so the real hardware is arm64.
fn host_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        return "arm64";
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(out) = Command::new("sysctl").arg("-n").arg("sysctl.proc_translated").output() {
            if String::from_utf8_lossy(&out.stdout).trim() == "1" {
                return "arm64"; // x86_64 process translated on Apple Silicon
            }
        }
    }
    "x64"
}

#[derive(Serialize, Clone)]
struct Progress {
    phase: String,
    percent: i32, // 0..=100, or -1 if unknown
    message: String,
}

fn emit(app: &AppHandle, event: &str, phase: &str, percent: i32, message: &str) {
    let _ = app.emit(event, Progress {
        phase: phase.to_string(),
        percent,
        message: message.to_string(),
    });
}

/// Download `url` into `dest_dir` and extract it. Emits progress on `event`.
async fn download_and_extract(
    app: &AppHandle,
    url: &str,
    dest_dir: &str,
    event: &str,
) -> Result<(), String> {
    let dest = PathBuf::from(dest_dir);
    fs::create_dir_all(&dest).map_err(|e| format!("create dest: {e}"))?;

    emit(app, event, "downloading", -1, "Contacting GitHub…");
    let resp = reqwest::get(url).await.map_err(|e| format!("download: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let archive_name = url.rsplit('/').next().unwrap_or("archive.zip").to_string();
    let archive_path = dest.join(&archive_name);

    let mut file = fs::File::create(&archive_path).map_err(|e| format!("create archive: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await.map_err(|e| format!("stream: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("write: {e}"))?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 { ((downloaded as f64 / total as f64) * 100.0) as i32 } else { -1 };
        emit(app, event, "downloading", pct, &format!("{downloaded} bytes"));
    }
    drop(file);

    emit(app, event, "extracting", -1, "Extracting…");
    let lower = archive_name.to_lowercase();
    if lower.ends_with(".zip") {
        extract_zip(&archive_path, &dest).map_err(|e| format!("unzip: {e}"))?;
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_tar_gz(&archive_path, &dest).map_err(|e| format!("untar: {e}"))?;
    } else {
        return Err(format!("unsupported archive type: {archive_name}"));
    }
    let _ = fs::remove_file(&archive_path);
    Ok(())
}

/// Generic command: download + extract, no executable location. Used for templates.
#[tauri::command]
async fn download_extract(app: AppHandle, url: String, dest_dir: String) -> Result<(), String> {
    download_and_extract(&app, &url, &dest_dir, "templates-progress").await?;
    emit(&app, "templates-progress", "done", 100, "Templates ready");
    Ok(())
}

/// Download the converter, extract, locate the executable, mark it runnable.
#[tauri::command]
async fn install_cli(app: AppHandle, url: String, dest_dir: String) -> Result<String, String> {
    download_and_extract(&app, &url, &dest_dir, "cli-install-progress").await?;

    emit(&app, "cli-install-progress", "locating", -1, "Locating ttrpg-convert…");
    let exe = if cfg!(target_os = "windows") { "ttrpg-convert.exe" } else { "ttrpg-convert" };
    let found = find_file(Path::new(&dest_dir), exe)
        .ok_or_else(|| format!("{exe} not found in archive"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&found).map_err(|e| format!("stat: {e}"))?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&found, perms).map_err(|e| format!("chmod: {e}"))?;
    }

    let path = found.to_string_lossy().to_string();
    emit(&app, "cli-install-progress", "done", 100, &path);
    Ok(path)
}

/// Run the converter at `exe_path`, streaming output via `converter-output`.
#[tauri::command]
async fn run_converter(
    app: AppHandle,
    exe_path: String,
    args: Vec<String>,
    cwd: String,
) -> Result<i32, String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    // Self-heal before spawning: the binary may have arrived without an
    // executable bit (zip extraction drops Unix modes, and installs located via
    // `find_converter` — remembered or manually-extracted folders — never get
    // chmod'd). Without this, `run_converter` fails with EACCES / "Permission
    // denied (os error 13)". Also strip macOS quarantine so Gatekeeper doesn't
    // block a binary the user downloaded through a browser.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&exe_path) {
            let mut perms = meta.permissions();
            // Add owner/group/other execute bits without clobbering read/write.
            perms.set_mode(perms.mode() | 0o111);
            let _ = fs::set_permissions(&exe_path, perms);
        }
        #[cfg(target_os = "macos")]
        {
            // Best-effort; harmless if the attribute isn't present.
            let _ = Command::new("xattr")
                .arg("-d")
                .arg("com.apple.quarantine")
                .arg(&exe_path)
                .output();
        }
    }

    let mut child = Command::new(&exe_path)
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {exe_path}: {e}"))?;

    let pump = |app: AppHandle, reader: Box<dyn BufRead + Send>| {
        std::thread::spawn(move || {
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit("converter-output", line);
            }
        })
    };
    if let Some(out) = child.stdout.take() { pump(app.clone(), Box::new(BufReader::new(out))); }
    if let Some(err) = child.stderr.take() { pump(app.clone(), Box::new(BufReader::new(err))); }

    let status = child.wait().map_err(|e| format!("wait: {e}"))?;
    Ok(status.code().unwrap_or(-1))
}

/// Write `contents` to `path` (creating parent dirs). Bypasses JS fs scope.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent: {e}"))?;
    }
    fs::write(&p, contents).map_err(|e| format!("write {path}: {e}"))
}

/// Copy the app's bundled starter assets into the user's CLI home: the Basic
/// Test Config (-> <home>/basic-test-config.json) and the custom "properties"
/// templates (-> <home>/examples/templates/tools5e/). Existing files are
/// overwritten. Returns the destination paths that were written.
#[tauri::command]
fn install_bundled_assets(app: AppHandle, home: String) -> Result<Vec<String>, String> {
    let res_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join("resources");

    let home_path = PathBuf::from(&home);
    let mut written: Vec<String> = vec![];

    // 1) Config -> <home>/basic-test-config.json
    let cfg_src = res_dir.join("basic-test-config.json");
    if cfg_src.is_file() {
        let dest = home_path.join("basic-test-config.json");
        fs::copy(&cfg_src, &dest).map_err(|e| format!("copy config: {e}"))?;
        written.push(dest.to_string_lossy().to_string());
    }

    // 2) Templates -> <home>/examples/templates/tools5e/
    let tpl_src = res_dir.join("templates").join("tools5e");
    let tpl_dest_dir = home_path.join("examples").join("templates").join("tools5e");
    fs::create_dir_all(&tpl_dest_dir).map_err(|e| format!("create template dir: {e}"))?;
    if tpl_src.is_dir() {
        for entry in fs::read_dir(&tpl_src)
            .map_err(|e| format!("read bundled templates: {e}"))?
            .flatten()
        {
            let path = entry.path();
            let is_txt = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("txt"))
                .unwrap_or(false);
            if path.is_file() && is_txt {
                if let Some(name) = path.file_name() {
                    let dest = tpl_dest_dir.join(name);
                    fs::copy(&path, &dest).map_err(|e| format!("copy template {name:?}: {e}"))?;
                    written.push(dest.to_string_lossy().to_string());
                }
            }
        }
    }

    if written.is_empty() {
        return Err("No bundled assets found to install.".to_string());
    }
    Ok(written)
}

/// Read a UTF-8 file from anywhere.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// List file names (not full paths) in `dir` ending with `ext` (e.g. ".txt").
/// Non-recursive. Returns [] if the directory does not exist.
#[tauri::command]
fn list_files(dir: String, ext: String) -> Result<Vec<String>, String> {
    let p = Path::new(&dir);
    if !p.is_dir() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(p).map_err(|e| format!("read_dir {dir}: {e}"))?.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if ext.is_empty() || name.to_lowercase().ends_with(&ext.to_lowercase()) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Recursively list files under `dir` ending with `ext`, returning paths
/// RELATIVE to `dir` with forward slashes (e.g. "book/Author; Title.json").
/// Skips hidden and underscore-prefixed folders (.git, _generated, _img …).
/// Returns [] if the directory does not exist.
#[tauri::command]
fn list_files_recursive(dir: String, ext: String) -> Result<Vec<String>, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let ext_l = ext.to_lowercase();
    let mut out: Vec<String> = vec![];
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let entries = match fs::read_dir(&cur) {
            Ok(e) => e,
            Err(_) => continue, // unreadable dir — skip rather than fail the whole walk
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if path.is_dir() {
                if name.starts_with('.') || name.starts_with('_') {
                    continue;
                }
                stack.push(path);
            } else if path.is_file()
                && (ext_l.is_empty() || name.to_lowercase().ends_with(&ext_l))
            {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Open a folder (or file) in the OS file manager. Runs in the Rust backend, so
/// it bypasses the shell plugin's URL-only `open` scope that rejects file paths.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    use std::process::Command;
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let result = if cfg!(target_os = "windows") {
        Command::new("explorer").arg(&path).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).spawn()
    } else {
        Command::new("xdg-open").arg(&path).spawn()
    };
    // On Windows, `explorer` returns a non-zero exit code even on success, so we
    // only treat a spawn failure (binary missing) as an error.
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Locate the converter executable under `home` WITHOUT walking the large data
/// folders (5etools-img, etc.). Checks home/bin and home/<exe> directly, then
/// recurses only into top-level dirs whose name starts with "ttrpg-convert"
/// (the extracted distribution, which is small). Returns the path or null.
#[tauri::command]
fn find_converter(home: String) -> Option<String> {
    let exe = if cfg!(target_os = "windows") { "ttrpg-convert.exe" } else { "ttrpg-convert" };
    let home_path = Path::new(&home);

    for direct in [home_path.join("bin").join(exe), home_path.join(exe)] {
        if direct.exists() {
            return Some(direct.to_string_lossy().to_string());
        }
    }
    if let Ok(entries) = fs::read_dir(home_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                if name.starts_with("ttrpg-convert") {
                    if let Some(found) = find_file(&p, exe) {
                        return Some(found.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    None
}

fn extract_zip(archive: &Path, dest: &Path) -> std::io::Result<()> {
    let file = fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let out = dest.join(entry.mangled_name());
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
        } else {
            if let Some(parent) = out.parent() { fs::create_dir_all(parent)?; }
            let mut w = fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut w)?;
        }
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> std::io::Result<()> {
    let file = fs::File::open(archive)?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(gz);
    tar.unpack(dest)
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().and_then(|n| n.to_str()) == Some(name) {
                return Some(p);
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            detect_host,
            download_extract,
            install_cli,
            run_converter,
            write_text_file,
            install_bundled_assets,
            read_text_file,
            list_files,
            list_files_recursive,
            path_exists,
            open_path,
            find_converter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
