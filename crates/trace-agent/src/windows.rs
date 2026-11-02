use super::*;
use crossbeam_queue::ArrayQueue;
use std::{
    io::Write,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use trace_ipc::{wide, Envelope, Request, Response, SecurityDescriptor, Status};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    System::{LibraryLoader::*, Registry::*, RemoteDesktop::*, Threading::*},
    UI::{HiDpi::*, Input::KeyboardAndMouse::GetDoubleClickTime, Shell::*, WindowsAndMessaging::*},
};
#[derive(Clone, Copy)]
enum Input {
    Event(PointerEvent),
    Suspend,
    Resume,
    Displays,
    Pause(i64),
    Unpause,
    Stop,
}
static QUEUE: OnceLock<Arc<ArrayQueue<Input>>> = OnceLock::new();
static DROPPED: AtomicU64 = AtomicU64::new(0);
static OVERFLOWS: AtomicU64 = AtomicU64::new(0);
static ENABLED: AtomicBool = AtomicBool::new(false);
static WINDOW: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static STOPPED: AtomicBool = AtomicBool::new(false);
const TRAY_MESSAGE: u32 = WM_APP + 1;
const TRAY_STATUS: u32 = WM_APP + 2;
fn push(i: Input) {
    if let Some(q) = QUEUE.get() {
        if q.push(i).is_err() {
            OVERFLOWS.fetch_add(1, Ordering::Relaxed);
        }
    }
}
unsafe extern "system" fn hook(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 && ENABLED.load(Ordering::Relaxed) {
        let m = &*(l as *const MSLLHOOKSTRUCT);
        let (kind, button) = match w as u32 {
            WM_MOUSEMOVE => (EventType::Move, None),
            WM_LBUTTONDOWN => (EventType::ButtonDown, Some(MouseButton::Left)),
            WM_LBUTTONUP => (EventType::ButtonUp, Some(MouseButton::Left)),
            WM_RBUTTONDOWN => (EventType::ButtonDown, Some(MouseButton::Right)),
            WM_RBUTTONUP => (EventType::ButtonUp, Some(MouseButton::Right)),
            WM_MBUTTONDOWN => (EventType::ButtonDown, Some(MouseButton::Middle)),
            WM_MBUTTONUP => (EventType::ButtonUp, Some(MouseButton::Middle)),
            WM_MOUSEWHEEL => (EventType::Wheel, None),
            WM_MOUSEHWHEEL => (EventType::HorizontalWheel, None),
            _ => return CallNextHookEx(null_mut(), code, w, l),
        };
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let q = QUEUE.get().unwrap();
        if kind == EventType::Move && q.len() > 6144 {
            DROPPED.fetch_add(1, Ordering::Relaxed);
        } else {
            let e = PointerEvent {
                timestamp_ms: ts,
                event_type: kind,
                x: m.pt.x,
                y: m.pt.y,
                wheel_delta: (m.mouseData >> 16) as i16,
                button,
            };
            if q.push(Input::Event(e)).is_err() {
                OVERFLOWS.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    CallNextHookEx(null_mut(), code, w, l)
}
unsafe extern "system" fn enum_monitor(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let monitors = &mut *(data as *mut Vec<Monitor>);
    let mut info: MONITORINFOEXW = std::mem::zeroed();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(h, (&mut info as *mut MONITORINFOEXW).cast()) != 0 {
        let name = String::from_utf16_lossy(
            &info.szDevice[..info.szDevice.iter().position(|x| *x == 0).unwrap_or(32)],
        );
        let mut id = 0u16;
        for b in name.bytes() {
            id = id.wrapping_mul(31).wrapping_add(b as u16);
        }
        while monitors.iter().any(|m| m.monitor_id == id) {
            id = id.wrapping_add(1);
        }
        let r = info.monitorInfo.rcMonitor;
        let (mut x, mut y) = (96, 96);
        let _ = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut x, &mut y);
        monitors.push(Monitor {
            monitor_id: id,
            device_name: name,
            left: r.left,
            top: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
            dpi_x: x as f64,
            dpi_y: y as f64,
        });
    }
    1
}
fn monitors() -> Vec<Monitor> {
    let mut result = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(enum_monitor),
            &mut result as *mut _ as isize,
        );
    }
    result
}
fn startup(enabled: bool) -> Result<()> {
    unsafe {
        let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
        let mut handle = null_mut();
        anyhow::ensure!(
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                null(),
                &mut handle,
                null_mut()
            ) == 0,
            "Cannot open current-user startup settings"
        );
        let name = wide("Trace");
        let result = if enabled {
            let exe = std::env::current_exe()?;
            let value = wide(&format!("\"{}\"", exe.display()));
            RegSetValueExW(
                handle,
                name.as_ptr(),
                0,
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            )
        } else {
            let r = RegDeleteValueW(handle, name.as_ptr());
            if r == ERROR_FILE_NOT_FOUND {
                0
            } else {
                r
            }
        };
        RegCloseKey(handle);
        anyhow::ensure!(result == 0, "Startup registration failed: {result}");
        Ok(())
    }
}
fn log(level: &str, message: &str) {
    if let Ok(dir) = trace_storage::data_dir() {
        let path = dir.join("trace.log");
        if std::fs::metadata(&path)
            .map(|m| m.len() > 5 * 1024 * 1024)
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(dir.join("trace.log.2"));
            let _ = std::fs::rename(dir.join("trace.log.1"), dir.join("trace.log.2"));
            let _ = std::fs::rename(&path, dir.join("trace.log.1"));
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(
                f,
                "{}",
                serde_json::json!({"ts":now_ms(),"level":level,"message":message})
            );
        }
    }
}
fn open_dashboard(settings: bool) {
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.with_file_name("trace.exe");
        let mut cmd = std::process::Command::new(path);
        if settings {
            cmd.arg("--settings");
        }
        if let Err(e) = cmd.spawn() {
            log("ERROR", &format!("Dashboard launch failed: {e}"));
        }
    }
}
fn open_bar() {
    if let Ok(exe) = std::env::current_exe() {
        if let Err(err) = std::process::Command::new(exe.with_file_name("trace.exe"))
            .arg("--show-bar")
            .spawn()
        {
            log("ERROR", &format!("Trace Bar launch failed: {err}"));
        }
    }
}
unsafe fn tray(hwnd: HWND, add: bool) {
    let mut data: NOTIFYICONDATAW = std::mem::zeroed();
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd;
    data.uID = 1;
    data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    data.uCallbackMessage = TRAY_MESSAGE;
    data.hIcon = LoadIconW(null_mut(), IDI_APPLICATION);
    let tip = wide(if ENABLED.load(Ordering::Relaxed) {
        "Trace · Tracking on"
    } else {
        "Trace · Tracking paused"
    });
    data.szTip[..tip.len()].copy_from_slice(&tip);
    Shell_NotifyIconW(if add { NIM_ADD } else { NIM_MODIFY }, &data);
}
unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        TRAY_STATUS => {
            tray(hwnd, false);
            0
        }
        TRAY_MESSAGE => {
            if l as u32 == WM_LBUTTONDBLCLK {
                open_dashboard(false);
            }
            if l as u32 == WM_RBUTTONUP {
                let menu = CreatePopupMenu();
                for (id, label) in [
                    (1, "Open Trace"),
                    (
                        0,
                        if ENABLED.load(Ordering::Relaxed) {
                            "Tracking: On"
                        } else {
                            "Tracking: Paused"
                        },
                    ),
                    (2, "Pause 15 minutes"),
                    (3, "Pause 30 minutes"),
                    (4, "Pause 1 hour"),
                    (5, "Pause until resumed"),
                    (6, "Resume tracking"),
                    (7, "Settings"),
                    (9, "Show Trace Bar"),
                    (8, "Stop Trace completely"),
                ] {
                    AppendMenuW(
                        menu,
                        MF_STRING | if id == 0 { MF_DISABLED } else { 0 },
                        id,
                        wide(label).as_ptr(),
                    );
                }
                let mut point: POINT = std::mem::zeroed();
                GetCursorPos(&mut point);
                SetForegroundWindow(hwnd);
                let choice = TrackPopupMenu(
                    menu,
                    TPM_RETURNCMD | TPM_RIGHTBUTTON,
                    point.x,
                    point.y,
                    0,
                    hwnd,
                    null(),
                );
                DestroyMenu(menu);
                match choice {
                    1 => open_dashboard(false),
                    2 => push(Input::Pause(900)),
                    3 => push(Input::Pause(1800)),
                    4 => push(Input::Pause(3600)),
                    5 => push(Input::Pause(0)),
                    6 => push(Input::Unpause),
                    7 => open_dashboard(true),
                    9 => open_bar(),
                    8 => {
                        push(Input::Stop);
                    }
                    _ => {}
                }
            }
            0
        }
        WM_POWERBROADCAST => {
            if w as u32 == PBT_APMSUSPEND {
                push(Input::Suspend);
            }
            if w as u32 == PBT_APMRESUMEAUTOMATIC || w as u32 == PBT_APMRESUMESUSPEND {
                push(Input::Resume);
            }
            1
        }
        WM_WTSSESSION_CHANGE => {
            if w as u32 == WTS_SESSION_LOCK {
                push(Input::Suspend);
            }
            if w as u32 == WTS_SESSION_UNLOCK {
                push(Input::Resume);
            }
            0
        }
        WM_DISPLAYCHANGE | WM_DPICHANGED => {
            push(Input::Displays);
            0
        }
        WM_QUERYENDSESSION => {
            push(Input::Stop);
            1
        }
        WM_ENDSESSION => {
            push(Input::Stop);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, w, l),
    }
}
fn flush(db: &mut Store, engine: &mut Engine, error: &mut Option<String>) -> bool {
    engine.checkpoint();
    match db.flush(&engine.pending, &engine.monitors, now_ms()) {
        Ok(()) => {
            engine.clear_pending();
            *error = None;
            true
        }
        Err(e) => {
            let msg = e.to_string();
            if error.as_deref() != Some(&msg) {
                log("ERROR", &msg);
            }
            *error = Some(msg);
            false
        }
    }
}
fn worker(
    q: Arc<ArrayQueue<Input>>,
    rx: mpsc::Receiver<Envelope>,
    mut db: Store,
    settings: Settings,
    next_id: i64,
    hub: Arc<trace_ipc::LiveHub>,
) {
    let mut e = Engine::new(settings, monitors(), now_ms(), next_id);
    let date = date_at(now_ms());
    e.today = db
        .daily(&Range {
            start: date.clone(),
            end: date,
        })
        .ok()
        .and_then(|mut d| d.pop())
        .map(|d| d.stats)
        .unwrap_or_default();
    let mut next_focus = db.next_focus_id().unwrap_or(1);
    let mut last_live = Instant::now() - Duration::from_secs(2);
    let mut insights = trace_metrics::InsightState::default();
    insights.history = db.bar_history(now_ms()).unwrap_or_default();
    let mut history_day = date_at(now_ms());
    let mut insight: Option<Insight> = None;
    let mut last_flush = Instant::now();
    let mut last_maint: Option<Instant> = None;
    let mut paused_until = None;
    let mut suspended = false;
    let mut storage_error = None;
    let mut stop = false;
    let mut overflows = 0;
    let mut previous_wall = now_ms();
    let mut ignore_before = 0;
    let mut last_raw_maint: Option<Instant> = None;
    let double_ms = unsafe { GetDoubleClickTime() } as i64;
    let extent = unsafe {
        (
            GetSystemMetrics(SM_CXDOUBLECLK),
            GetSystemMetrics(SM_CYDOUBLECLK),
        )
    };
    while !stop {
        let now = now_ms();
        let mut publish = false;
        if now < previous_wall || now - previous_wall > 5000 {
            e.resume_after_gap(now);
        }
        previous_wall = now;
        if paused_until.is_some_and(|t| now >= t) {
            e.set_paused(false, now);
            paused_until = None;
            publish = true;
        }
        let count = OVERFLOWS.load(Ordering::Relaxed);
        if count != overflows {
            e.suspend(now);
            overflows = count;
            log("WARN", "Input queue overflow; movement anchors reset");
        }
        for _ in 0..8192 {
            let Some(input) = q.pop() else { break };
            match input {
                Input::Event(mut event) => {
                    if !suspended && event.timestamp_ms > ignore_before {
                        event.timestamp_ms = event.timestamp_ms.min(now);
                        e.process(event, double_ms, extent);
                    }
                }
                Input::Pause(seconds) => {
                    publish = true;
                    e.set_paused(true, now);
                    paused_until = if seconds > 0 {
                        Some(now + seconds * 1000)
                    } else {
                        None
                    };
                    flush(&mut db, &mut e, &mut storage_error);
                }
                Input::Unpause => {
                    publish = true;
                    e.set_paused(false, now);
                    paused_until = None;
                }
                Input::Suspend => {
                    publish = true;
                    e.suspend(now);
                    suspended = true;
                    flush(&mut db, &mut e, &mut storage_error);
                }
                Input::Resume => {
                    publish = true;
                    e.resume_after_gap(now);
                    suspended = false;
                    e.monitors = monitors();
                }
                Input::Displays => {
                    publish = true;
                    e.reset_anchor();
                    e.monitors = monitors();
                }
                Input::Stop => {
                    stop = true;
                }
            }
        }
        if !suspended {
            e.tick(now);
        }
        while let Ok((request, reply)) = rx.try_recv() {
            publish |= matches!(
                &request,
                Request::Pause { .. }
                    | Request::Resume
                    | Request::SaveSettings { .. }
                    | Request::SetBarSettings { .. }
                    | Request::SetIncognito { .. }
                    | Request::StartFocus
                    | Request::EndFocus
                    | Request::DeleteRange { .. }
                    | Request::DeleteAll
                    | Request::Stop
            );
            let result = (|| -> Result<serde_json::Value> {
                match request {
                    Request::GetLiveStats => {
                        return Ok(serde_json::to_value(live_frame(
                            &e,
                            now,
                            paused_until,
                            suspended,
                            &storage_error,
                            &insight,
                        ))?)
                    }
                    Request::GetBarSettings => {
                        return Ok(serde_json::to_value(&e.settings.trace_bar)?)
                    }
                    Request::GetStatus => {
                        return Ok(serde_json::to_value(Status {
                            incognito: e.incognito,
                            tracking: e.settings.tracking_enabled
                                && !e.paused
                                && !e.incognito
                                && !suspended,
                            idle: e.current.is_none(),
                            paused_until,
                            paused: e.paused,
                            dropped_moves: DROPPED.load(Ordering::Relaxed),
                            queue_overflows: overflows,
                            storage_error: storage_error.clone(),
                            current_session: e.current.clone(),
                        })?)
                    }
                    Request::GetSettings => return Ok(serde_json::to_value(&e.settings)?),
                    Request::SetBarSettings { settings } => {
                        settings.validate()?;
                        let mut next = e.settings.clone();
                        next.trace_bar = settings;
                        db.save_settings(&next)?;
                        e.settings = next;
                    }
                    Request::SetIncognito { enabled } => {
                        if enabled && !e.incognito {
                            e.suspend(now);
                            e.end_focus(now);
                            anyhow::ensure!(
                                flush(&mut db, &mut e, &mut storage_error),
                                "Cannot enter incognito before saving existing aggregates"
                            );
                        }
                        e.set_incognito(enabled, now);
                        if enabled {
                            insight = None;
                        }
                        ignore_before = now;
                    }
                    Request::StartFocus => {
                        anyhow::ensure!(!suspended, "Cannot start focus while suspended");
                        e.start_focus(next_focus, now)?;
                        next_focus += 1;
                    }
                    Request::EndFocus => {
                        let focus = e
                            .end_focus(now)
                            .ok_or_else(|| anyhow::anyhow!("No active focus session"))?;
                        insight = Some(Insight {
                            id: format!("focus-{}", focus.id),
                            priority: 2,
                            title: "Focus completed".into(),
                            message: format!(
                                "{}m {}s · {} clicks",
                                (now - focus.start_ts) / 60000,
                                (now - focus.start_ts) / 1000 % 60,
                                focus.stats.clicks()
                            ),
                            route: "/focus".into(),
                            expires_ts: now + 15000,
                        });
                    }
                    Request::Pause { duration_seconds } => {
                        if let Some(s) = duration_seconds {
                            anyhow::ensure!(
                                [900, 1800, 3600].contains(&s),
                                "Invalid pause duration"
                            );
                        }
                        e.set_paused(true, now);
                        paused_until = duration_seconds.map(|s| now + s * 1000);
                    }
                    Request::Resume => {
                        e.set_paused(false, now);
                        paused_until = None;
                    }
                    Request::SaveSettings { settings } => {
                        settings.validate()?;
                        let old = e.settings.clone();
                        if settings.launch_at_login != old.launch_at_login {
                            startup(settings.launch_at_login)?;
                        }
                        if let Err(err) = db.save_settings(&settings) {
                            if settings.launch_at_login != old.launch_at_login {
                                let _ = startup(old.launch_at_login);
                            }
                            return Err(err);
                        }
                        if settings.tracking_enabled != old.tracking_enabled
                            || settings.idle_threshold_seconds != old.idle_threshold_seconds
                        {
                            e.suspend(now);
                            if !settings.tracking_enabled {
                                e.end_focus(now);
                            }
                        }
                        e.settings = settings;
                    }
                    Request::Stop => {
                        stop = true;
                    }
                    request => {
                        anyhow::ensure!(
                            flush(&mut db, &mut e, &mut storage_error),
                            "Database unavailable; pending aggregates retained"
                        );
                        last_flush = Instant::now();
                        return match request {
                            Request::GetToday => {
                                let date = date_at(now);
                                Ok(serde_json::to_value(db.dashboard(
                                    &Range {
                                        start: date.clone(),
                                        end: date,
                                    },
                                    None,
                                )?)?)
                            }
                            Request::GetRange { range, monitor } => {
                                Ok(serde_json::to_value(db.dashboard(&range, monitor)?)?)
                            }
                            Request::GetSessions { range } => {
                                Ok(serde_json::to_value(db.sessions(&range)?)?)
                            }
                            Request::GetFocusSessions { range } => {
                                Ok(serde_json::to_value(db.focus_sessions(&range)?)?)
                            }
                            Request::GetHeatmap { range, monitor } => Ok(serde_json::to_value(
                                db.dashboard(&range, monitor)?.heatmap,
                            )?),
                            Request::GetCurrentSession => Ok(serde_json::to_value(&e.current)?),
                            Request::Export { format, range } => {
                                Ok(serde_json::to_value(db.export(&format, &range)?)?)
                            }
                            Request::DeleteRange { range } => {
                                e.end_focus(now);
                                range.bounds()?;
                                e.suspend(now);
                                anyhow::ensure!(
                                    flush(&mut db, &mut e, &mut storage_error),
                                    "Cannot flush before deletion"
                                );
                                db.delete(&range)?;
                                insights = trace_metrics::InsightState::default();
                                insights.history = db.bar_history(now)?;
                                insight = None;
                                e.completed_focus = None;
                                let date = date_at(now);
                                e.today = db
                                    .daily(&Range {
                                        start: date.clone(),
                                        end: date,
                                    })?
                                    .into_iter()
                                    .next()
                                    .map(|d| d.stats)
                                    .unwrap_or_default();
                                Ok(serde_json::Value::Null)
                            }
                            Request::DeleteAll => {
                                e.end_focus(now);
                                e.suspend(now);
                                anyhow::ensure!(
                                    flush(&mut db, &mut e, &mut storage_error),
                                    "Cannot flush before deletion"
                                );
                                let tx = db.conn.transaction()?;
                                for table in [
                                    "focus_sessions",
                                    "raw_events",
                                    "minute_stats",
                                    "hourly_stats",
                                    "heatmap_hourly",
                                    "session_days",
                                    "sessions",
                                    "daily_stats",
                                    "monitors",
                                ] {
                                    tx.execute(&format!("DELETE FROM {table}"), [])?;
                                }
                                tx.commit()?;
                                e.today = Stats::default();
                                e.completed_focus = None;
                                db.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                                insights = trace_metrics::InsightState::default();
                                insight = None;
                                Ok(serde_json::Value::Null)
                            }
                            _ => unreachable!(),
                        };
                    }
                }
                flush(&mut db, &mut e, &mut storage_error);
                last_flush = Instant::now();
                Ok(serde_json::Value::Null)
            })();
            let _ = reply.send(match result {
                Ok(v) => Response::ok(v),
                Err(err) => Response::err(err),
            });
        }
        let enabled = e.settings.tracking_enabled && !e.paused && !e.incognito && !suspended;
        if ENABLED.swap(enabled, Ordering::Relaxed) != enabled {
            unsafe {
                PostMessageW(WINDOW.load(Ordering::Relaxed) as HWND, TRAY_STATUS, 0, 0);
            }
        }
        if (last_flush.elapsed() >= Duration::from_secs(10)
            || e.pending.raw.len() >= 2048
            || e.pending.heat.len() >= 16384)
            && flush(&mut db, &mut e, &mut storage_error)
        {
            last_flush = Instant::now();
        }
        // Bound the buffer during extended storage failure; make lost collection visible, never silently invent data.
        if storage_error.is_some() && (e.pending.raw.len() > 8192 || e.pending.heat.len() > 32768) {
            e.set_paused(true, now);
            log(
                "ERROR",
                "Tracking paused because persistence is unavailable; pending data retained",
            );
        }
        if last_maint.is_none_or(|last| last.elapsed() >= Duration::from_secs(86400)) {
            if let Err(err) = db.maintain(now, &e.settings) {
                log("WARN", &err.to_string());
            }
            last_maint = Some(Instant::now());
        }
        if last_raw_maint.is_none_or(|last| last.elapsed() >= Duration::from_secs(60)) {
            if let Err(err) = db.trim_raw(now, &e.settings) {
                log("WARN", &err.to_string());
            }
            last_raw_maint = Some(Instant::now());
        }
        if insight.as_ref().is_some_and(|i| i.expires_ts <= now) {
            insight = None;
        }
        if publish || last_live.elapsed() >= Duration::from_secs(1) {
            let date = date_at(now);
            if date != history_day {
                insights.history = db.bar_history(now).unwrap_or_default();
                history_day = date;
            }
            if !e.incognito && insight.is_none() {
                insight =
                    insights.consider(now, &e.today, e.current.as_ref(), &e.settings.trace_bar);
            }
            hub.publish(live_frame(
                &e,
                now,
                paused_until,
                suspended,
                &storage_error,
                &insight,
            ));
            last_live = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(if enabled && e.current.is_some() {
            10
        } else {
            100
        }));
    }
    e.end_focus(now_ms());
    e.suspend(now_ms());
    for _ in 0..3 {
        if flush(&mut db, &mut e, &mut storage_error) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    ENABLED.store(false, Ordering::Relaxed);
    STOPPED.store(true, Ordering::Relaxed);
    unsafe {
        PostMessageW(WINDOW.load(Ordering::Relaxed) as HWND, WM_CLOSE, 0, 0);
    }
}
fn live_frame(
    e: &Engine,
    now: i64,
    paused_until: Option<i64>,
    suspended: bool,
    storage_error: &Option<String>,
    insight: &Option<Insight>,
) -> LiveStats {
    LiveStats {
        timestamp_ms: now,
        tracking: e.settings.tracking_enabled && !e.paused && !e.incognito && !suspended,
        paused: e.paused,
        paused_until,
        incognito: e.incognito,
        suspended,
        session: e.current.clone(),
        today: e.today.clone(),
        focus: e.focus.clone(),
        completed_focus: e.completed_focus.clone(),
        settings: e.settings.clone(),
        distance_dpi: if e.monitors.len() == 1 {
            e.monitors[0].dpi_x
        } else {
            96.
        },
        insight: insight.clone(),
        storage_error: storage_error.clone(),
    }
}
pub fn run() -> Result<()> {
    std::panic::set_hook(Box::new(|info| {
        log("ERROR", &format!("Collector panic: {info}"))
    }));
    unsafe {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let security = SecurityDescriptor::current_user()?;
        let mutex = CreateMutexW(
            &security.attributes,
            0,
            wide(&format!(
                "Local\\Trace-Agent-{}",
                trace_ipc::instance_key()?
            ))
            .as_ptr(),
        );
        anyhow::ensure!(!mutex.is_null(), "Cannot initialize collector mutex");
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(mutex);
            return Ok(());
        }
        let dir = trace_storage::data_dir()?;
        let db = Store::open(dir.join("trace.db"))?;
        let settings = db.settings()?;
        let launch_bar = settings.trace_bar.enabled
            && settings.trace_bar.launch_with_trace
            && !std::env::args().any(|a| a == "--no-bar");
        let next_id = db.recover_sessions(now_ms())?;
        let queue = Arc::new(ArrayQueue::new(8192));
        let _ = QUEUE.set(queue.clone());
        let module = GetModuleHandleW(null());
        let class_name = wide("TraceCollectorWindow");
        let mut class: WNDCLASSW = std::mem::zeroed();
        class.lpfnWndProc = Some(wndproc);
        class.hInstance = module;
        class.lpszClassName = class_name.as_ptr();
        RegisterClassW(&class);
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide("Trace").as_ptr(),
            0,
            0,
            0,
            0,
            0,
            null_mut(),
            null_mut(),
            module,
            null(),
        );
        anyhow::ensure!(!hwnd.is_null(), "Cannot create collector message window");
        WINDOW.store(hwnd as isize, Ordering::Relaxed);
        WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
        tray(hwnd, true);
        let (tx, rx) = mpsc::sync_channel(32);
        let ipc = std::thread::spawn(move || {
            if let Err(e) = trace_ipc::serve(tx) {
                log("ERROR", &e.to_string());
                push(Input::Stop);
            }
        });
        drop(ipc);
        let hub = Arc::new(trace_ipc::LiveHub::default());
        let shared = hub.clone();
        std::thread::spawn(move || {
            if let Err(err) = trace_ipc::serve_live(shared) {
                log("ERROR", &err.to_string());
            }
        });
        let worker = std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                worker(queue, rx, db, settings, next_id, hub)
            }));
            if result.is_err() {
                ENABLED.store(false, Ordering::Relaxed);
                STOPPED.store(true, Ordering::Relaxed);
                PostMessageW(WINDOW.load(Ordering::Relaxed) as HWND, WM_CLOSE, 0, 0);
            }
        });
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(hook), module, 0);
        anyhow::ensure!(!mouse.is_null(), "Cannot install global pointer hook");
        log("INFO", "Collector started");
        if launch_bar {
            if let Ok(exe) = std::env::current_exe() {
                let path = exe.with_file_name("trace.exe");
                if path.exists() {
                    let _ = std::process::Command::new(path).arg("--bar-only").spawn();
                }
            }
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if !STOPPED.load(Ordering::Relaxed) {
            push(Input::Stop);
        }
        UnhookWindowsHookEx(mouse);
        let _ = worker.join();
        WTSUnRegisterSessionNotification(hwnd);
        let mut data: NOTIFYICONDATAW = std::mem::zeroed();
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = 1;
        Shell_NotifyIconW(NIM_DELETE, &data);
        CloseHandle(mutex);
        log("INFO", "Collector stopped");
        Ok(())
    }
}
