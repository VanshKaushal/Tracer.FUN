use crate::{Session, Settings, Stats};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    Left,
    #[default]
    Right,
    Bottom,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct BarSettings {
    pub enabled: bool,
    pub launch_with_trace: bool,
    pub edge: DockEdge,
    pub monitor: String,
    pub offset: f64,
    pub auto_collapse: bool,
    pub hide_fullscreen: bool,
    pub show_during_focus_fullscreen: bool,
    pub notifications_fullscreen: bool,
    pub show_live_timer: bool,
    pub show_clicks: bool,
    pub show_distance: bool,
    pub hover_timer: bool,
    pub hover_clicks: bool,
    pub hover_distance: bool,
    pub hover_scroll: bool,
    pub hover_active: bool,
    pub notifications: bool,
    pub personal_records: bool,
    pub focus_mode: bool,
}
impl Default for BarSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            launch_with_trace: true,
            edge: DockEdge::Right,
            monitor: String::new(),
            offset: 0.46,
            auto_collapse: true,
            hide_fullscreen: true,
            show_during_focus_fullscreen: false,
            notifications_fullscreen: false,
            show_live_timer: true,
            show_clicks: true,
            show_distance: true,
            hover_timer: true,
            hover_clicks: true,
            hover_distance: true,
            hover_scroll: false,
            hover_active: false,
            notifications: true,
            personal_records: true,
            focus_mode: true,
        }
    }
}
impl BarSettings {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.offset.is_finite() && (0.0..=1.0).contains(&self.offset),
            "Invalid Trace Bar offset"
        );
        anyhow::ensure!(self.monitor.len() <= 256, "Invalid Trace Bar monitor");
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FocusSession {
    pub id: i64,
    pub start_ts: i64,
    pub end_ts: Option<i64>,
    pub updated_ts: i64,
    pub stats: Stats,
    pub context_switches: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Insight {
    pub id: String,
    pub priority: u8,
    pub title: String,
    pub message: String,
    pub route: String,
    pub expires_ts: i64,
}
#[derive(Clone, Debug, Default)]
pub struct BarHistory {
    pub recorded_days: usize,
    pub weekday_days: usize,
    pub weekday_clicks: f64,
    pub weekday_clicks_stddev: f64,
    pub max_daily_clicks: u64,
    pub max_daily_distance: f64,
    pub longest_month_session_ms: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LiveStats {
    pub timestamp_ms: i64,
    pub tracking: bool,
    pub paused: bool,
    pub paused_until: Option<i64>,
    pub incognito: bool,
    pub suspended: bool,
    pub session: Option<Session>,
    pub today: Stats,
    pub focus: Option<FocusSession>,
    pub completed_focus: Option<FocusSession>,
    pub settings: Settings,
    pub distance_dpi: f64,
    pub insight: Option<Insight>,
    pub storage_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
pub fn dock_position(area: WorkArea, size: (u32, u32), edge: DockEdge, offset: f64) -> (i32, i32) {
    let dx = area.width.saturating_sub(size.0) as f64;
    let dy = area.height.saturating_sub(size.1) as f64;
    let offset = if offset.is_finite() {
        offset.clamp(0., 1.)
    } else {
        0.46
    };
    let (x, y) = match edge {
        DockEdge::Left => (0., dy * offset),
        DockEdge::Right => (dx, dy * offset),
        DockEdge::Bottom => (dx * offset, dy),
    };
    (area.x + x.round() as i32, area.y + y.round() as i32)
}
pub fn snap_position(
    area: WorkArea,
    size: (u32, u32),
    point: (i32, i32),
    threshold: i32,
) -> Option<(DockEdge, f64)> {
    let dx = area.width.saturating_sub(size.0) as i32;
    let dy = area.height.saturating_sub(size.1) as i32;
    let x = point.0 - area.x;
    let y = point.1 - area.y;
    let candidates = [
        (x.abs(), DockEdge::Left),
        ((dx - x).abs(), DockEdge::Right),
        ((dy - y).abs(), DockEdge::Bottom),
    ];
    let (distance, edge) = candidates.into_iter().min_by_key(|c| c.0)?;
    if distance > threshold {
        return None;
    }
    let offset = match edge {
        DockEdge::Bottom => x as f64 / dx.max(1) as f64,
        _ => y as f64 / dy.max(1) as f64,
    };
    Some((edge, offset.clamp(0., 1.)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn docking_respects_work_area_and_negative_origins() {
        let area = WorkArea {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };
        assert_eq!(
            dock_position(area, (48, 48), DockEdge::Right, 1.),
            (-48, 992)
        );
        assert_eq!(
            snap_position(area, (48, 48), (-1910, 496), 48),
            Some((DockEdge::Left, 0.5))
        );
        assert_eq!(
            snap_position(area, (48, 48), (-55, 496), 48),
            Some((DockEdge::Right, 0.5))
        );
        assert_eq!(
            snap_position(area, (48, 48), (-984, 990), 48),
            Some((DockEdge::Bottom, 0.5))
        );
        assert_eq!(snap_position(area, (48, 48), (-900, 450), 48), None);
        assert_eq!(
            dock_position(area, (4000, 4000), DockEdge::Bottom, 0.5),
            (-1920, 0)
        );
    }
    #[test]
    fn old_settings_get_safe_bar_defaults() {
        let settings: Settings = serde_json::from_str("{\"distance_unit\":\"cm\"}").unwrap();
        assert!(settings.trace_bar.hide_fullscreen);
        assert_eq!(settings.distance_unit, "cm");
        let bar = BarSettings {
            offset: f64::NAN,
            ..Default::default()
        };
        assert!(bar.validate().is_err());
    }
}
