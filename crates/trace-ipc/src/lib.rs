use anyhow::Result;
use serde::{Deserialize, Serialize};
use trace_core::{Session, Settings};
use trace_storage::Range;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "command", content = "args")]
pub enum Request {
    GetStatus,
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
    pub tracking: bool,
    pub idle: bool,
    pub paused_until: Option<i64>,
    pub paused: bool,
    pub dropped_moves: u64,
    pub queue_overflows: u64,
    pub storage_error: Option<String>,
    pub current_session: Option<Session>,
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
