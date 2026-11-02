use anyhow::Result;
use serde::{Deserialize, Serialize};
use trace_core::{BarSettings, LiveStats, Session, Settings};
use trace_storage::Range;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "command", content = "args")]
pub enum Request {
    GetStatus,
    GetLiveStats,
    GetBarSettings,
    SetBarSettings { settings: BarSettings },
    SetIncognito { enabled: bool },
    StartFocus,
    EndFocus,
    GetFocusSessions { range: Range },
    GetToday,
    GetRange { range: Range, monitor: Option<u16> },
    GetSessions { range: Range },
    GetHeatmap { range: Range, monitor: Option<u16> },
    GetCurrentSession,
    Pause { duration_seconds: Option<i64> },
    Resume,
    GetSettings,
    SaveSettings { settings: Settings },
    DeleteRange { range: Range },
    DeleteAll,
    Export { format: String, range: Range },
    Stop,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Status {
    pub incognito: bool,
    pub tracking: bool,
    pub idle: bool,
    pub paused_until: Option<i64>,
    pub paused: bool,
    pub dropped_moves: u64,
    pub queue_overflows: u64,
    pub storage_error: Option<String>,
    pub current_session: Option<Session>,
}
// A bounded latest-value channel; slow subscribers skip old frames instead of accumulating events.
#[derive(Default)]
pub struct LiveHub {
    state: std::sync::Mutex<(u64, Option<LiveStats>)>,
    changed: std::sync::Condvar,
}
impl LiveHub {
    pub fn publish(&self, value: LiveStats) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.0 = state.0.wrapping_add(1);
        state.1 = Some(value);
        self.changed.notify_all();
    }
    pub fn latest(&self) -> Option<LiveStats> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .1
            .clone()
    }
    pub fn wait(&self, revision: u64) -> (u64, Option<LiveStats>) {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (state, _) = self
            .changed
            .wait_timeout_while(state, std::time::Duration::from_secs(2), |s| {
                s.0 == revision
            })
            .unwrap_or_else(|e| e.into_inner());
        (state.0, state.1.clone())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Response {
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}
impl Response {
    pub fn ok<T: Serialize>(v: T) -> Self {
        match serde_json::to_value(v) {
            Ok(v) => Self {
                data: Some(v),
                error: None,
            },
            Err(e) => Self::err(e),
        }
    }
    pub fn err(e: impl std::fmt::Display) -> Self {
        Self {
            data: None,
            error: Some(e.to_string()),
        }
    }
    pub fn result(self) -> Result<serde_json::Value> {
        if let Some(e) = self.error {
            anyhow::bail!(e);
        }
        Ok(self.data.unwrap_or(serde_json::Value::Null))
    }
}
#[cfg(windows)]
mod pipe;
#[cfg(windows)]
pub use pipe::*;
#[cfg(not(windows))]
pub fn call(_request: &Request) -> Result<serde_json::Value> {
    anyhow::bail!("Trace requires Windows 10/11")
}
