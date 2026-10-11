use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use trace_core::{dock_position, snap_position, BarSettings, DockEdge, LiveStats, WorkArea};

#[derive(Default)]
pub struct BarRuntime {
    pub mode: String,
    pub settings: BarSettings,
    pub dragging: bool,
    pub closed: bool,
    pub free_position: Option<(String, i32, i32)>,
    pub latest: Option<LiveStats>,
}
pub type SharedBar = Arc<Mutex<BarRuntime>>;
// A live frame and a reopen request can arrive together. Serialize get/build
// so they cannot create two windows with the same label.
static WINDOW_CREATION: Mutex<()> = Mutex::new(());

pub fn open_dashboard(app: &tauri::AppHandle, route: &str) -> Result<(), String> {
    let route = match route {
        "/settings" | "/heatmap" | "/sessions" | "/focus" | "/history" | "/insights" => route,
        _ => "/",
    };
    let creation = WINDOW_CREATION.lock().map_err(|e| e.to_string())?;
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("Trace")
            .inner_size(1200., 820.)
            .min_inner_size(900., 650.)
            .initialization_script(format!("window.location.hash = '{}';", route))
            .build()
            .map_err(|e| e.to_string())?,
    };
    drop(creation);
    window
        .eval(format!("window.location.hash = '{}';", route))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn create(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    let _creation = WINDOW_CREATION.lock().map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("trace-bar") {
        return Ok(w);
    }
    let mode = app
        .state::<SharedBar>()
        .lock()
        .map_err(|e| e.to_string())?
        .mode
        .clone();
    WebviewWindowBuilder::new(app, "trace-bar", WebviewUrl::App("trace-bar.html".into()))
        .title("Trace Bar")
        .initialization_script(format!("window.location.hash = '{}';", mode))
        .inner_size(18., 48.)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}
fn area(monitor: &tauri::Monitor) -> WorkArea {
    let r = monitor.work_area();
    WorkArea {
        x: r.position.x,
        y: r.position.y,
        width: r.size.width,
        height: r.size.height,
    }
}
fn selected_monitor(window: &tauri::WebviewWindow, name: &str) -> Result<tauri::Monitor, String> {
    window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| m.name().is_some_and(|n| n == name))
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("No monitor available".into())
}
fn fullscreen(window: &tauri::WebviewWindow) -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{Foundation::RECT, Graphics::Gdi::*, UI::WindowsAndMessaging::*};
        let foreground = GetForegroundWindow();
        if foreground.is_null()
            || foreground
                == window
                    .hwnd()
                    .map(|h| h.0 as _)
                    .unwrap_or(std::ptr::null_mut())
            || foreground == GetShellWindow()
            || foreground == GetDesktopWindow()
        {
            return false;
        }
        let mut rect: RECT = std::mem::zeroed();
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST);
        if GetWindowRect(foreground, &mut rect) == 0 || GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        // Only hide on the overlay's own display.
        let own = window
            .hwnd()
            .ok()
            .map(|h| MonitorFromWindow(h.0 as _, MONITOR_DEFAULTTONEAREST));
        own == Some(monitor)
            && rect.left <= info.rcMonitor.left
            && rect.top <= info.rcMonitor.top
            && rect.right >= info.rcMonitor.right
            && rect.bottom >= info.rcMonitor.bottom
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}
pub fn apply(app: &tauri::AppHandle, state: &SharedBar) -> Result<(), String> {
    let (settings, mode, dragging, closed, free, live) = {
        let s = state.lock().map_err(|e| e.to_string())?;
        (
            s.settings.clone(),
            s.mode.clone(),
            s.dragging,
            s.closed,
            s.free_position.clone(),
            s.latest.clone(),
        )
    };
    if !settings.enabled || closed {
        if let Some(w) = app.get_webview_window("trace-bar") {
            let _ = w.close();
        }
        return Ok(());
    }
    let window = create(app)?;
    if dragging {
        return Ok(());
    }
    let monitor = selected_monitor(
        &window,
        free.as_ref()
            .map(|p| p.0.as_str())
            .unwrap_or(&settings.monitor),
    )?;
    let scale = monitor.scale_factor();
    let bottom = settings.edge == DockEdge::Bottom;
    let hover_count = [
        settings.hover_timer,
        settings.hover_clicks,
        settings.hover_distance,
        settings.hover_scroll,
        settings.hover_active,
    ]
    .into_iter()
    .filter(|v| *v)
    .count();
    let logical: (f64, f64) = match mode.as_str() {
        "expanded" | "contextual" => (280., 350.),
        "compact" if bottom => (112. + 100. * hover_count as f64, 64.),
        "compact" => (240., 44. + 44. * hover_count.div_ceil(2) as f64),
        _ if bottom => (48., 18.),
        _ => (18., 48.),
    };
    let working = area(&monitor);
    let size = (
        (logical.0 * scale).round() as u32,
        (logical.1 * scale).round() as u32,
    );
    let size = (size.0.min(working.width), size.1.min(working.height));
    let point = free
        .map(|(_, x, y)| {
            (
                x.clamp(
                    working.x,
                    working.x + working.width.saturating_sub(size.0) as i32,
                ),
                y.clamp(
                    working.y,
                    working.y + working.height.saturating_sub(size.1) as i32,
                ),
            )
        })
        .unwrap_or_else(|| dock_position(working, size, settings.edge, settings.offset));
    if window.outer_size().map_err(|e| e.to_string())? != PhysicalSize::new(size.0, size.1) {
        window
            .set_size(PhysicalSize::new(size.0, size.1))
            .map_err(|e| e.to_string())?;
    }
    if window.outer_position().map_err(|e| e.to_string())?
        != PhysicalPosition::new(point.0, point.1)
    {
        window
            .set_position(PhysicalPosition::new(point.0, point.1))
            .map_err(|e| e.to_string())?;
    }
    window
        .set_focusable(mode == "expanded" || mode == "contextual")
        .map_err(|e| e.to_string())?;
    let hidden = live.as_ref().is_some_and(|l| l.suspended)
        || (settings.hide_fullscreen
            && fullscreen(&window)
            && !(settings.show_during_focus_fullscreen
                && live.as_ref().is_some_and(|l| l.focus.is_some()))
            && !(settings.notifications_fullscreen && mode == "contextual"));
    if hidden {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    } else if !window.is_visible().unwrap_or(false) {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn open_trace_dashboard(app: tauri::AppHandle, route: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_dashboard(&app, &route))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_bar_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBar>,
    mode: String,
    activate: bool,
) -> Result<(), String> {
    if !["peek", "compact", "expanded", "contextual"].contains(&mode.as_str()) {
        return Err("Invalid bar mode".into());
    }
    state.lock().map_err(|e| e.to_string())?.mode = mode;
    apply(&app, &state)?;
    if activate {
        if let Some(w) = app.get_webview_window("trace-bar") {
            w.set_focusable(true).map_err(|e| e.to_string())?;
            w.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn show_trace_bar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBar>,
) -> Result<(), String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || show_bar(&app, &shared))
        .await
        .map_err(|e| e.to_string())?
}

pub fn show_bar(app: &tauri::AppHandle, state: &SharedBar) -> Result<(), String> {
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.closed = false;
        s.mode = "expanded".into();
    }
    apply(app, state)?;
    if let Some(w) = app.get_webview_window("trace-bar") {
        let _ = w.emit("trace-bar-invoke", ());
        let _ = w.set_focus();
    }
    Ok(())
}
#[tauri::command]
pub fn close_trace_bar(
    app: tauri::AppHandle,
    state: tauri::State<SharedBar>,
) -> Result<(), String> {
    state.lock().map_err(|e| e.to_string())?.closed = true;
    if let Some(w) = app.get_webview_window("trace-bar") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn drag_trace_bar(app: tauri::AppHandle, state: tauri::State<SharedBar>) -> Result<(), String> {
    let window = app
        .get_webview_window("trace-bar")
        .ok_or("Trace Bar unavailable")?;
    state.lock().map_err(|e| e.to_string())?.dragging = true;
    if let Err(err) = window.start_dragging() {
        state.lock().map_err(|e| e.to_string())?.dragging = false;
        return Err(err.to_string());
    }
    let shared = state.inner().clone();
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
            let started = std::time::Instant::now();
            while unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0
                && started.elapsed().as_secs() < 30
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        let result = (|| -> Result<(), String> {
            let point = window.outer_position().map_err(|e| e.to_string())?;
            let size = window.outer_size().map_err(|e| e.to_string())?;
            let monitor = window
                .monitor_from_point(
                    (point.x + size.width as i32 / 2) as f64,
                    (point.y + size.height as i32 / 2) as f64,
                )
                .map_err(|e| e.to_string())?
                .ok_or("No monitor")?;
            let mut settings = shared.lock().map_err(|e| e.to_string())?.settings.clone();
            let snap = snap_position(
                area(&monitor),
                (size.width, size.height),
                (point.x, point.y),
                (48. * monitor.scale_factor()) as i32,
            );
            if let Some((edge, offset)) = snap {
                settings.edge = edge;
                settings.offset = offset;
                settings.monitor = monitor.name().cloned().unwrap_or_default();
                trace_ipc::call(&trace_ipc::Request::SetBarSettings {
                    settings: settings.clone(),
                })
                .map_err(|e| e.to_string())?;
            }
            {
                let mut s = shared.lock().map_err(|e| e.to_string())?;
                s.settings = settings;
                s.free_position = if snap.is_some() {
                    None
                } else {
                    Some((
                        monitor.name().cloned().unwrap_or_default(),
                        point.x,
                        point.y,
                    ))
                };
                s.dragging = false;
            }
            apply(&app, &shared)
        })();
        shared.lock().unwrap_or_else(|e| e.into_inner()).dragging = false;
        let _ = window.emit("trace-bar-drag-ended", result.err());
    });
    Ok(())
}
