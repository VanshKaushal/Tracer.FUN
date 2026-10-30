#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};
use trace_ipc::Request;
mod bar;

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
    let path = if beside.exists() || !cfg!(debug_assertions) {
        beside
    } else {
        dev
    };
    if !path.exists() {
        return Err("Trace is missing a required file. Reinstall Trace using the latest Windows setup; your saved history will be kept.".into());
    }
    let mut cmd = std::process::Command::new(&path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| {
            if e.raw_os_error() == Some(4551) {
                "Windows Application Control blocked the Trace collector. Use a release signed by a trusted publisher, or contact your device administrator. Your history is safe. (Windows error 4551)".into()
            } else {
                format!("Trace could not start its collector. Try Reconnect. If this continues, reinstall Trace; your history will be kept. Details: {e}")
            }
        })?;
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
            if args.iter().any(|a| a == "--quit") {
                app.exit(0);
                return;
            }
            // Windows delivers this callback inside WM_COPYDATA. Creating a
            // WebView here blocks the message loop and every later launch.
            let app = app.clone();
            std::thread::spawn(move || {
                let state = app.state::<bar::SharedBar>().inner().clone();
                let result = if args.iter().any(|a| a == "--show-all") {
                    bar::open_dashboard(&app, "/").and_then(|()| bar::show_bar(&app, &state))
                } else if args.iter().any(|a| a == "--show-bar") {
                    bar::show_bar(&app, &state)
                } else if args.iter().any(|a| a == "--bar-only") {
                    bar::apply(&app, &state)
                } else {
                    bar::open_dashboard(
                        &app,
                        if args.iter().any(|a| a == "--settings") {
                            "/settings"
                        } else {
                            "/"
                        },
                    )
                };
                if let Err(err) = result {
                    let _ = app.emit("trace-unavailable", err);
                }
            });
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportFolder(Mutex::new(None)))
        .manage(std::sync::Arc::new(Mutex::new(bar::BarRuntime {
            mode: "peek".into(),
            ..Default::default()
        })) as bar::SharedBar)
        .setup(|app| {
            // Installers can close an existing host without opening a new
            // dashboard or starting a collector when Trace is already closed.
            if std::env::args().any(|a| a == "--quit") {
                app.handle().exit(0);
                return Ok(());
            }
            let handle = app.handle().clone();
            if !std::env::args().any(|a| a == "--bar-only" || a == "--show-bar") {
                bar::open_dashboard(
                    &handle,
                    if std::env::args().any(|a| a == "--settings") {
                        "/settings"
                    } else {
                        "/"
                    },
                )
                .map_err(std::io::Error::other)?;
            }
            let state = app.state::<bar::SharedBar>().inner().clone();
            std::thread::spawn(move || {
                if let Err(err) = ensure_agent() {
                    let _ = handle.emit("trace-unavailable", err);
                }
                let delays = [1, 2, 5, 10, 30];
                let mut attempt = 0;
                loop {
                    let result = trace_ipc::subscribe(|frame| {
                        attempt = 0;
                        let invoked;
                        {
                            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                            invoked = s.latest.is_none()
                                && std::env::args().any(|a| a == "--show-bar" || a == "--show-all");
                            if invoked {
                                s.mode = "expanded".into();
                                s.closed = false;
                            }
                            if s.latest.is_none()
                                && !frame.settings.trace_bar.launch_with_trace
                                && !std::env::args().any(|a| a == "--show-bar" || a == "--show-all")
                            {
                                s.closed = true;
                            }
                            if s.settings.edge != frame.settings.trace_bar.edge
                                || s.settings.monitor != frame.settings.trace_bar.monitor
                                || s.settings.offset != frame.settings.trace_bar.offset
                            {
                                s.free_position = None;
                            }
                            if !s.settings.enabled && frame.settings.trace_bar.enabled {
                                s.closed = false;
                            }
                            s.settings = frame.settings.trace_bar.clone();
                            s.latest = Some(frame.clone());
                        }
                        let _ = bar::apply(&handle, &state);
                        if invoked {
                            if let Some(w) = handle.get_webview_window("trace-bar") {
                                let _ = w.set_focus();
                            }
                        }
                        let _ = handle.emit("trace-live", &frame);
                        true
                    });
                    if let Err(err) = result {
                        let _ = handle.emit("trace-unavailable", err.to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_secs(delays[attempt.min(4)]));
                    attempt += 1;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            collector,
            restart_collector,
            choose_export_folder,
            export_files,
            bar::open_trace_dashboard,
            bar::set_bar_mode,
            bar::show_trace_bar,
            bar::close_trace_bar,
            bar::drag_trace_bar
        ])
        .on_window_event(|window, event| {
            if window.label() == "trace-bar"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window
                    .state::<bar::SharedBar>()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .closed = true;
            }
        })
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
