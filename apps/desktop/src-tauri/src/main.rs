#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use tauri::Manager;
use trace_ipc::Request;

struct ExportFolder(Mutex<Option<PathBuf>>);
static AGENT_START: Mutex<()> = Mutex::new(());
fn ensure_agent() -> Result<(), String> {
    let _guard = AGENT_START.lock().map_err(|e| e.to_string())?;
    if trace_ipc::call(&Request::GetStatus).is_ok() {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let beside = exe.with_file_name("trace-agent.exe");
    let dev =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../target/debug/trace-agent.exe");
    let path = if beside.exists() { beside } else { dev };
    if !path.exists() {
        return Err(format!("Collector executable missing at {}. Keep trace.exe and trace-agent.exe together, or run npm run desktop.", path.display()));
    }
    let mut cmd = std::process::Command::new(&path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Collector could not start ({}): {e}", path.display()))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if trace_ipc::call(&Request::GetStatus).is_ok() {
            return Ok(());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "Collector exited ({status}). Check %LOCALAPPDATA%\\Trace\\trace.log."
            ));
        }
        if std::time::Instant::now() >= deadline {
            return Err("Collector did not become ready. Check %LOCALAPPDATA%\\Trace\\trace.log and click Reconnect.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}
#[tauri::command]
async fn collector(request: Request) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        trace_ipc::call(&request).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn restart_collector() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(ensure_agent)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn choose_export_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExportFolder>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .set_title("Choose where to export Trace data")
        .blocking_pick_folder();
    let path = folder
        .map(|f| f.into_path())
        .transpose()
        .map_err(|e| e.to_string())?;
    let selected = path.is_some();
    *state.0.lock().map_err(|e| e.to_string())? = path;
    Ok(selected)
}
#[tauri::command]
async fn export_files(
    request: Request,
    state: tauri::State<'_, ExportFolder>,
) -> Result<String, String> {
    if !matches!(&request, Request::Export { .. }) {
        return Err("Invalid export command".into());
    }
    let folder = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("Choose an export folder first")?;
    tauri::async_runtime::spawn_blocking(move || {
        let data = trace_ipc::call(&request).map_err(|e| e.to_string())?;
        let files: BTreeMap<String, String> =
            serde_json::from_value(data).map_err(|e| e.to_string())?;
        let destination = folder.join(format!(
            "Trace-export-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis()
        ));
        std::fs::create_dir(&destination).map_err(|e| e.to_string())?;
        for (name, contents) in files {
            if ![
                "trace.json",
                "daily.csv",
                "sessions.csv",
                "minute_stats.csv",
            ]
            .contains(&name.as_str())
            {
                return Err("Invalid export filename".into());
            }
            std::fs::write(destination.join(name), contents).map_err(|e| e.to_string())?;
        }
        Ok(destination.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                if args.iter().any(|a| a == "--settings") {
                    let _ = window.eval("window.location.hash = '/settings'");
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportFolder(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            collector,
            restart_collector,
            choose_export_folder,
            export_files
        ])
        .on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && std::env::args().any(|a| a == "--settings")
            {
                let _ = window.eval("window.location.hash = '/settings'");
            }
        })
        .run(tauri::generate_context!())
        .expect("Trace desktop failed to start");
}
