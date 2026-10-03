#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use anyhow::Result;
use trace_core::*;
use trace_metrics::Engine;
use trace_storage::{Range, Store};
#[cfg(windows)]
mod windows;

fn simulate() -> Result<()> {
    let s = Settings {
        tracking_enabled: true,
        ..Settings::default()
    };
    let m = Monitor {
        monitor_id: 1,
        device_name: "Synthetic display".into(),
        left: -1920,
        top: 0,
        width: 1920,
        height: 1080,
        dpi_x: 96.,
        dpi_y: 96.,
    };
    let start = Range {
        start: "2026-10-01".into(),
        end: "2026-10-01".into(),
    }
    .bounds()?
    .0;
    let mut engine = Engine::new(s, vec![m], start, 0);
    let started = std::time::Instant::now();
    for i in 0..1_000_000 {
        engine.process(
            PointerEvent {
                timestamp_ms: start + i,
                event_type: EventType::Move,
                x: -1900 + (i % 1800) as i32,
                y: (i % 1000) as i32,
                wheel_delta: 0,
                button: None,
            },
            500,
            (4, 4),
        );
        if i % 10000 == 0 {
            engine.checkpoint();
            engine.clear_pending();
        }
    }
    engine.checkpoint();
    let mut db = Store::open(":memory:")?;
    db.flush(&engine.pending, &engine.monitors, start + 1_000_000)?;
    println!(
        "1,000,000 synthetic events processed in {:?}; bounded pending heat cells: {}",
        started.elapsed(),
        engine.pending.heat.len()
    );
    Ok(())
}
fn main() -> Result<()> {
    if std::env::args().any(|a| a == "--simulate") {
        return simulate();
    }
    if std::env::args().any(|a| a == "--stop") {
        let _ = trace_ipc::call(&trace_ipc::Request::Stop);
        return Ok(());
    }
    #[cfg(windows)]
    {
        windows::run()
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("The collector requires Windows. Use --simulate to validate the portable metrics engine.")
    }
}
