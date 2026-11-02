use chrono::{Local, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
mod bar;
pub use bar::*;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub enum EventType {
    Move,
    ButtonDown,
    ButtonUp,
    Wheel,
    HorizontalWheel,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}
impl MouseButton {
    pub fn index(self) -> usize {
        match self {
            Self::Left => 0,
            Self::Right => 1,
            Self::Middle => 2,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct PointerEvent {
    pub timestamp_ms: i64,
    pub event_type: EventType,
    pub x: i32,
    pub y: i32,
    pub wheel_delta: i16,
    pub button: Option<MouseButton>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Monitor {
    pub monitor_id: u16,
    pub device_name: String,
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub dpi_x: f64,
    pub dpi_y: f64,
}
impl Monitor {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left
            && y >= self.top
            && i64::from(x) < i64::from(self.left) + i64::from(self.width)
            && i64::from(y) < i64::from(self.top) + i64::from(self.height)
    }
    pub fn normalize(&self, x: i32, y: i32) -> (f64, f64) {
        (
            ((x as f64 - self.left as f64) / self.width.max(1) as f64).clamp(0., 1.),
            ((y as f64 - self.top as f64) / self.height.max(1) as f64).clamp(0., 1.),
        )
    }
    pub fn cell(&self, x: i32, y: i32) -> (u8, u8) {
        let (nx, ny) = self.normalize(x, y);
        (
            (nx * 64.).floor().min(63.) as u8,
            (ny * 36.).floor().min(35.) as u8,
        )
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub launch_at_login: bool,
    pub tracking_enabled: bool,
    pub idle_threshold_seconds: i64,
    pub raw_retention_hours: i64,
    pub minute_retention_days: i64,
    pub theme: String,
    pub accent_color: String,
    pub distance_unit: String,
    pub application_tracking_enabled: bool,
    pub onboarding_complete: bool,
    pub trace_bar: BarSettings,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            tracking_enabled: false,
            idle_threshold_seconds: 300,
            raw_retention_hours: 24,
            minute_retention_days: 30,
            theme: "dark".into(),
            accent_color: "#b6e77d".into(),
            distance_unit: "px".into(),
            application_tracking_enabled: false,
            onboarding_complete: false,
            trace_bar: BarSettings::default(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> anyhow::Result<()> {
        self.trace_bar.validate()?;
        anyhow::ensure!(
            (60..=1800).contains(&self.idle_threshold_seconds),
            "Idle threshold must be 1–30 minutes"
        );
        anyhow::ensure!(
            (1..=24).contains(&self.raw_retention_hours),
            "Raw retention must be 1–24 hours"
        );
        anyhow::ensure!(
            (7..=30).contains(&self.minute_retention_days),
            "Minute retention must be 7–30 days"
        );
        anyhow::ensure!(
            !self.application_tracking_enabled,
            "Application context is a future opt-in feature"
        );
        anyhow::ensure!(
            ["dark", "light", "system"].contains(&self.theme.as_str()),
            "Invalid theme"
        );
        anyhow::ensure!(
            ["px", "mm", "cm", "m", "km", "in", "ft", "yd", "mi"]
                .contains(&self.distance_unit.as_str()),
            "Invalid distance unit"
        );
        anyhow::ensure!(
            self.accent_color.len() == 7
                && self.accent_color.starts_with('#')
                && self.accent_color[1..]
                    .chars()
                    .all(|c| c.is_ascii_hexdigit()),
            "Invalid accent color"
        );
        Ok(())
    }
}
// Additive aggregates. Histograms stay bounded even during multi-day sessions.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub active_ms: i64,
    pub idle_ms: i64,
    pub distance_px: f64,
    pub movement_samples: u64,
    pub left_clicks: u64,
    pub right_clicks: u64,
    pub middle_clicks: u64,
    pub double_clicks: u64,
    pub drag_count: u64,
    pub drag_distance_px: f64,
    pub drag_duration_ms: i64,
    pub scroll_delta: i64,
    pub horizontal_scroll_delta: i64,
    pub scroll_abs_delta: u64,
    pub scroll_events: u64,
    pub scroll_bursts: u64,
    pub direction_changes: u64,
    pub session_count: u64,
    pub speed_sum: f64,
    pub speed_count: u64,
    pub max_speed: f64,
    pub speed_histogram: [u64; 32],
    pub efficiency_sum: f64,
    pub efficiency_count: u64,
}
impl Stats {
    pub fn clicks(&self) -> u64 {
        self.left_clicks + self.right_clicks + self.middle_clicks
    }
    pub fn merge(&mut self, rhs: &Self) {
        macro_rules! add { ($($f:ident),*) => { $(self.$f += rhs.$f;)* }; }
        add!(
            active_ms,
            idle_ms,
            distance_px,
            movement_samples,
            left_clicks,
            right_clicks,
            middle_clicks,
            double_clicks,
            drag_count,
            drag_distance_px,
            drag_duration_ms,
            scroll_delta,
            horizontal_scroll_delta,
            scroll_abs_delta,
            scroll_events,
            scroll_bursts,
            direction_changes,
            session_count,
            speed_sum,
            speed_count,
            efficiency_sum,
            efficiency_count
        );
        self.max_speed = self.max_speed.max(rhs.max_speed);
        for (a, b) in self.speed_histogram.iter_mut().zip(rhs.speed_histogram) {
            *a += b;
        }
    }
    pub fn percentile_speed(&self, percentile: f64) -> f64 {
        let target = (self.speed_count as f64 * percentile).ceil() as u64;
        if target == 0 {
            return 0.;
        }
        let mut n = 0;
        for (i, c) in self.speed_histogram.iter().enumerate() {
            n += c;
            if n >= target {
                return (2f64.powf((i as f64 + 1.) / 2.) - 1.).min(self.max_speed);
            }
        }
        self.max_speed
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HeatCell {
    pub hour_start: i64,
    pub monitor_id: u16,
    pub grid_x: u8,
    pub grid_y: u8,
    pub dwell_ms: i64,
    pub left_clicks: u64,
    pub right_clicks: u64,
    pub middle_clicks: u64,
    pub scroll_count: u64,
    pub drag_count: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub start_ts: i64,
    pub end_ts: Option<i64>,
    pub stats: Stats,
}
#[derive(Clone, Debug)]
pub struct SessionDay {
    pub id: i64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub stats: Stats,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RawEvent {
    pub ts: i64,
    pub event_type: String,
    pub x_norm: f64,
    pub y_norm: f64,
    pub monitor_id: u16,
}
#[derive(Clone, Debug, Default)]
pub struct Batch {
    pub focus_sessions: std::collections::BTreeMap<i64, FocusSession>,
    pub minutes: std::collections::BTreeMap<i64, Stats>,
    pub heat: std::collections::BTreeMap<(i64, u16, u8, u8), HeatCell>,
    pub sessions: std::collections::BTreeMap<i64, Session>,
    pub raw: Vec<RawEvent>,
    pub session_days: std::collections::BTreeMap<(i64, i64), SessionDay>,
}
pub fn date_at(ts: i64) -> String {
    Local
        .timestamp_millis_opt(ts)
        .single()
        .unwrap()
        .format("%Y-%m-%d")
        .to_string()
}
pub fn hour_at(ts: i64) -> i64 {
    let t = Local.timestamp_millis_opt(ts).single().unwrap();
    ts - (t.minute() as i64 * 60000 + t.second() as i64 * 1000 + t.timestamp_subsec_millis() as i64)
}
pub fn day_at(ts: i64) -> i64 {
    let t = Local.timestamp_millis_opt(ts).single().unwrap();
    Local
        .from_local_datetime(&t.date_naive().and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .unwrap()
        .timestamp_millis()
}
pub fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

#[cfg(test)]
mod distance_unit_tests {
    use super::Settings;

    #[test]
    fn accepts_supported_distance_units_and_rejects_unknown_units() {
        let mut settings = Settings::default();
        for unit in ["px", "mm", "cm", "m", "km", "in", "ft", "yd", "mi"] {
            settings.distance_unit = unit.into();
            assert!(settings.validate().is_ok(), "{unit}");
        }
        settings.distance_unit = "unknown".into();
        assert!(settings.validate().is_err());
    }
}
