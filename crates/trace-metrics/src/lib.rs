use std::collections::BTreeMap;
use trace_core::*;

pub fn distance(a: (i32, i32), b: (i32, i32)) -> f64 {
    (b.0 as f64 - a.0 as f64).hypot(b.1 as f64 - a.1 as f64)
}
pub fn direction_delta(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % std::f64::consts::TAU;
    d.min(std::f64::consts::TAU - d)
}
#[derive(Clone, Copy)]
struct Press {
    ts: i64,
    x: i32,
    y: i32,
    path: f64,
    maximum: f64,
}
pub struct Engine {
    pub settings: Settings,
    pub monitors: Vec<Monitor>,
    pub pending: Batch,
    pub current: Option<Session>,
    pub paused: bool,
    last_tick: i64,
    last_interaction: Option<i64>,
    anchor: Option<PointerEvent>,
    sampled: Option<PointerEvent>,
    direction: Option<f64>,
    presses: [Option<Press>; 3],
    last_click: [Option<PointerEvent>; 3],
    click_pair: [bool; 3],
    previous_target: Option<(i32, i32)>,
    target_path: f64,
    last_scroll: Option<i64>,
    next_session: i64,
    cell: Option<(u16, u8, u8)>,
    bucket_cache: Option<(i64, i64, i64)>,
}
impl Engine {
    pub fn new(settings: Settings, monitors: Vec<Monitor>, now: i64, next_session: i64) -> Self {
        Self {
            settings,
            monitors,
            pending: Batch::default(),
            current: None,
            paused: false,
            last_tick: now,
            last_interaction: None,
            anchor: None,
            sampled: None,
            direction: None,
            presses: [None; 3],
            last_click: [None; 3],
            click_pair: [false; 3],
            previous_target: None,
            target_path: 0.,
            last_scroll: None,
            next_session,
            cell: None,
            bucket_cache: None,
        }
    }
    fn buckets(&mut self, ts: i64) -> (i64, i64, i64) {
        let minute = ts.div_euclid(60000) * 60000;
        if self.bucket_cache.is_none_or(|c| c.0 != minute) {
            self.bucket_cache = Some((minute, hour_at(ts), day_at(ts)));
        }
        self.bucket_cache.unwrap()
    }
    fn record(&mut self, ts: i64, s: Stats) {
        let (minute, _, day) = self.buckets(ts);
        self.pending.minutes.entry(minute).or_default().merge(&s);
        if let Some(session) = &mut self.current {
            session.stats.merge(&s);
            let row = self
                .pending
                .session_days
                .entry((session.id, day))
                .or_insert_with(|| SessionDay {
                    id: session.id,
                    start_ts: ts,
                    end_ts: ts,
                    stats: Stats::default(),
                });
            row.end_ts = row.end_ts.max(ts + s.active_ms);
            row.stats.merge(&s);
        }
    }
    pub fn reset_anchor(&mut self) {
        self.anchor = None;
        self.sampled = None;
        self.direction = None;
        self.presses = [None; 3];
        self.last_click = [None; 3];
        self.click_pair = [false; 3];
        self.previous_target = None;
        self.target_path = 0.;
        self.last_scroll = None;
        self.cell = None;
    }
    fn close_session(&mut self, end: i64) {
        if let Some(mut session) = self.current.take() {
            session.end_ts = Some(end.max(session.start_ts));
            self.pending.sessions.insert(session.id, session);
        }
        self.reset_anchor();
    }
    pub fn suspend(&mut self, now: i64) {
        self.tick(now);
        self.close_session(now);
        self.last_interaction = None;
        self.last_tick = now;
    }
    pub fn resume_after_gap(&mut self, now: i64) {
        self.close_session(self.last_tick);
        self.last_tick = now;
        self.last_interaction = None;
    }
    pub fn set_paused(&mut self, paused: bool, now: i64) {
        self.suspend(now);
        self.paused = paused;
    }
    pub fn tick(&mut self, now: i64) {
        // Wall-clock jumps and suspend must never create artificial hours or distance.
        if now < self.last_tick || now - self.last_tick > 5000 {
            self.resume_after_gap(now);
            return;
        }
        if self.paused || !self.settings.tracking_enabled {
            self.last_tick = now;
            return;
        }
        let active_until = self
            .last_interaction
            .map(|t| t + self.settings.idle_threshold_seconds * 1000);
        let mut cursor = self.last_tick;
        while cursor < now {
            let boundary = (cursor.div_euclid(60000) + 1) * 60000;
            let end = boundary.min(now);
            let active = active_until
                .map(|t| (end.min(t) - cursor).clamp(0, end - cursor))
                .unwrap_or(0);
            let s = Stats {
                active_ms: active,
                idle_ms: end - cursor - active,
                ..Stats::default()
            };
            self.record(cursor, s);
            if let Some((monitor_id, x, y)) = self.cell {
                let key = (self.buckets(cursor).1, monitor_id, x, y);
                let h = self.pending.heat.entry(key).or_insert_with(|| HeatCell {
                    hour_start: key.0,
                    monitor_id,
                    grid_x: x,
                    grid_y: y,
                    ..HeatCell::default()
                });
                h.dwell_ms += active;
            }
            cursor = end;
        }
        if let Some(t) = active_until {
            if now >= t {
                self.close_session(t);
                self.last_interaction = None;
            }
        }
        self.last_tick = now;
    }
    pub fn process(&mut self, mut e: PointerEvent, double_ms: i64, double_extent: (i32, i32)) {
        // Events may spend a few milliseconds in the input queue after a timer tick.
        e.timestamp_ms = e.timestamp_ms.max(self.last_tick);
        self.tick(e.timestamp_ms);
        if self.paused || !self.settings.tracking_enabled {
            return;
        }
        if self.current.is_none() {
            self.next_session += 1;
            self.current = Some(Session {
                id: self.next_session,
                start_ts: e.timestamp_ms,
                end_ts: None,
                stats: Stats::default(),
            });
            self.record(
                e.timestamp_ms,
                Stats {
                    session_count: 1,
                    ..Stats::default()
                },
            );
        }
        self.last_interaction = Some(e.timestamp_ms);
        let monitor = self.monitors.iter().find(|m| m.contains(e.x, e.y)).cloned();
        self.cell = monitor.as_ref().map(|m| {
            let (x, y) = m.cell(e.x, e.y);
            (m.monitor_id, x, y)
        });
        let mut s = Stats::default();
        if let Some(prev) = self.anchor {
            let previous_monitor_known = self.monitors.iter().any(|m| m.contains(prev.x, prev.y));
            if monitor.is_some() && previous_monitor_known {
                let d = distance((prev.x, prev.y), (e.x, e.y));
                s.distance_px = d;
                self.target_path += d;
                for press in self.presses.iter_mut().flatten() {
                    press.path += d;
                    press.maximum = press.maximum.max(distance((press.x, press.y), (e.x, e.y)));
                }
            } else {
                self.sampled = None;
                self.direction = None;
                self.previous_target = None;
                self.target_path = 0.;
            }
        }
        if e.event_type == EventType::Move {
            let dx = self.sampled.map(|p| e.x as f64 - p.x as f64).unwrap_or(0.);
            let dy = self.sampled.map(|p| e.y as f64 - p.y as f64).unwrap_or(0.);
            let length = dx.hypot(dy);
            let angle = dy.atan2(dx);
            let turn = self
                .direction
                .map(|a| direction_delta(a, angle) > std::f64::consts::PI / 6.)
                .unwrap_or(false);
            let elapsed = self
                .sampled
                .map(|p| e.timestamp_ms - p.timestamp_ms)
                .unwrap_or(25);
            if elapsed >= 25 || length >= 6. || (turn && length >= 2.) {
                s.movement_samples = 1;
                if elapsed > 0 && length > 0. {
                    let speed = length * 1000. / elapsed as f64;
                    s.speed_sum = speed;
                    s.speed_count = 1;
                    s.max_speed = speed;
                    s.speed_histogram[(((speed + 1.).log2() * 2.).floor() as usize).min(31)] = 1;
                }
                if turn && length >= 2. {
                    s.direction_changes = 1;
                }
                if length >= 2. {
                    self.direction = Some(angle);
                }
                self.sampled = Some(e);
            }
        }
        let mut kind = None;
        if let Some(button) = e.button {
            let i = button.index();
            if e.event_type == EventType::ButtonDown {
                self.presses[i] = Some(Press {
                    ts: e.timestamp_ms,
                    x: e.x,
                    y: e.y,
                    path: 0.,
                    maximum: 0.,
                });
            }
            if e.event_type == EventType::ButtonUp {
                if let Some(press) = self.presses[i].take() {
                    let duration = e.timestamp_ms - press.ts;
                    if press.maximum > 6. {
                        s.drag_count = 1;
                        s.drag_distance_px = press.path;
                        s.drag_duration_ms = duration.max(0);
                        kind = Some("drag");
                    } else if (0..=1000).contains(&duration) {
                        match button {
                            MouseButton::Left => s.left_clicks = 1,
                            MouseButton::Right => s.right_clicks = 1,
                            MouseButton::Middle => s.middle_clicks = 1,
                        };
                        kind = Some("click");
                        if !self.click_pair[i]
                            && self.last_click[i]
                                .map(|p| {
                                    e.timestamp_ms - p.timestamp_ms >= 0
                                        && e.timestamp_ms - p.timestamp_ms <= double_ms
                                        && (e.x as i64 - p.x as i64).abs()
                                            <= i64::from(double_extent.0) / 2
                                        && (e.y as i64 - p.y as i64).abs()
                                            <= i64::from(double_extent.1) / 2
                                })
                                .unwrap_or(false)
                        {
                            s.double_clicks = 1;
                            self.click_pair[i] = true;
                        } else {
                            self.click_pair[i] = false;
                        }
                        self.last_click[i] = Some(e);
                        if let Some(a) = self.previous_target {
                            let direct = distance(a, (e.x, e.y));
                            if direct >= 20. && self.target_path > 0. {
                                s.efficiency_sum = (direct / self.target_path).clamp(0., 1.);
                                s.efficiency_count = 1;
                            }
                        }
                        self.previous_target = Some((e.x, e.y));
                        self.target_path = 0.;
                    }
                }
            }
        }
        if matches!(e.event_type, EventType::Wheel | EventType::HorizontalWheel) {
            if e.event_type == EventType::Wheel {
                s.scroll_delta = e.wheel_delta as i64;
            } else {
                s.horizontal_scroll_delta = e.wheel_delta as i64;
            }
            s.scroll_abs_delta = (e.wheel_delta as i64).unsigned_abs();
            s.scroll_events = 1;
            if self
                .last_scroll
                .map(|t| e.timestamp_ms - t > 300)
                .unwrap_or(true)
            {
                s.scroll_bursts = 1;
            }
            self.last_scroll = Some(e.timestamp_ms);
        }
        if let Some(m) = monitor {
            let (x, y) = m.cell(e.x, e.y);
            let key = (self.buckets(e.timestamp_ms).1, m.monitor_id, x, y);
            let h = self.pending.heat.entry(key).or_insert_with(|| HeatCell {
                hour_start: key.0,
                monitor_id: m.monitor_id,
                grid_x: x,
                grid_y: y,
                ..HeatCell::default()
            });
            h.left_clicks += s.left_clicks;
            h.right_clicks += s.right_clicks;
            h.middle_clicks += s.middle_clicks;
            h.drag_count += s.drag_count;
            h.scroll_count += s.scroll_events;
            if let Some(k) = kind {
                let (x_norm, y_norm) = m.normalize(e.x, e.y);
                self.pending.raw.push(RawEvent {
                    ts: e.timestamp_ms,
                    event_type: k.into(),
                    x_norm,
                    y_norm,
                    monitor_id: m.monitor_id,
                });
            }
        }
        self.anchor = Some(e);
        self.record(e.timestamp_ms, s);
    }
    pub fn checkpoint(&mut self) {
        if let Some(s) = &self.current {
            self.pending.sessions.insert(s.id, s.clone());
        }
    }
    pub fn clear_pending(&mut self) {
        self.pending = Batch {
            minutes: BTreeMap::new(),
            ..Batch::default()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine(now: i64) -> Engine {
        let mut s = Settings::default();
        s.tracking_enabled = true;
        s.idle_threshold_seconds = 60;
        Engine::new(
            s,
            vec![Monitor {
                monitor_id: 1,
                device_name: "negative".into(),
                left: -1920,
                top: 0,
                width: 1920,
                height: 1080,
                dpi_x: 96.,
                dpi_y: 96.,
            }],
            now,
            0,
        )
    }
    fn event(t: i64, x: i32, y: i32, kind: EventType) -> PointerEvent {
        PointerEvent {
            timestamp_ms: t,
            x,
            y,
            event_type: kind,
            wheel_delta: 120,
            button: if matches!(kind, EventType::ButtonDown | EventType::ButtonUp) {
                Some(MouseButton::Left)
            } else {
                None
            },
        }
    }
    fn totals(e: &Engine) -> Stats {
        let mut s = Stats::default();
        for v in e.pending.minutes.values() {
            s.merge(v);
        }
        s
    }
    #[test]
    fn geometry_and_negative_monitor() {
        assert_eq!(distance((0, 0), (3, 4)), 5.);
        let e = engine(0);
        assert_eq!(e.monitors[0].cell(-1, 1079), (63, 35));
        assert_eq!(e.monitors[0].normalize(-1920, 0), (0., 0.));
        assert!(direction_delta(-3.1, 3.1) < 0.1);
    }
    #[test]
    fn click_drag_double_scroll() {
        let mut e = engine(0);
        for (t, k) in [
            (0, EventType::ButtonDown),
            (10, EventType::ButtonUp),
            (100, EventType::ButtonDown),
            (110, EventType::ButtonUp),
            (200, EventType::ButtonDown),
            (210, EventType::ButtonUp),
        ] {
            e.process(event(t, -100, 10, k), 500, (4, 4));
        }
        e.process(event(300, -100, 10, EventType::ButtonDown), 500, (4, 4));
        e.process(event(320, -80, 10, EventType::Move), 500, (4, 4));
        e.process(event(330, -80, 10, EventType::ButtonUp), 500, (4, 4));
        e.process(event(340, -80, 10, EventType::Wheel), 500, (4, 4));
        let s = totals(&e);
        assert_eq!(s.left_clicks, 3);
        assert_eq!(s.double_clicks, 1);
        assert_eq!(s.drag_count, 1);
        assert_eq!(s.scroll_abs_delta, 120);
        assert_eq!(s.distance_px, 20.);
    }
    #[test]
    fn idle_session_and_resume() {
        let mut e = engine(0);
        e.process(event(0, -10, 10, EventType::Move), 500, (4, 4));
        for t in 1..=65 {
            e.tick(t * 1000);
        }
        assert!(e.current.is_none());
        let s = totals(&e);
        assert_eq!(s.active_ms, 60000);
        assert_eq!(s.idle_ms, 5000);
        e.process(event(66000, -500, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).distance_px, 0.);
        assert_eq!(totals(&e).session_count, 2);
    }
    #[test]
    fn midnight_split_and_pause() {
        let mut e = engine(59000);
        e.process(event(59000, -10, 10, EventType::Move), 500, (4, 4));
        e.tick(61000);
        assert_eq!(e.pending.minutes[&0].active_ms, 1000);
        assert_eq!(e.pending.minutes[&60000].active_ms, 1000);
        e.set_paused(true, 61000);
        e.process(event(62000, -500, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).active_ms, 2000);
    }
    #[test]
    fn sleep_clock_jump_and_efficiency() {
        let mut e = engine(0);
        e.process(event(0, -100, 10, EventType::Move), 500, (4, 4));
        e.tick(1000000);
        e.process(event(1000010, -1, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).distance_px, 0.);
        e.tick(10);
        assert!(e.current.is_none());
    }
    #[test]
    fn high_rate_path_not_lost() {
        let mut e = engine(0);
        for i in 0..1000 {
            e.process(event(i, -1000 + i as i32, 10, EventType::Move), 500, (4, 4));
        }
        assert_eq!(totals(&e).distance_px, 999.);
        assert!(totals(&e).movement_samples < 200);
    }
    #[test]
    fn monitor_disconnect_does_not_bridge_distance() {
        let mut e = engine(0);
        e.process(event(0, -100, 10, EventType::Move), 500, (4, 4));
        e.reset_anchor();
        e.monitors.clear();
        e.process(event(100, 1000, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).distance_px, 0.);
        assert!(e.cell.is_none());
    }
    #[test]
    fn queued_events_do_not_reset_session() {
        let mut e = engine(0);
        e.process(event(0, -100, 10, EventType::Move), 500, (4, 4));
        e.tick(1000);
        e.process(event(999, -90, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).session_count, 1);
        assert_eq!(totals(&e).distance_px, 10.);
    }
    #[test]
    fn adjacent_monitor_transition_preserves_virtual_pixel_distance() {
        let mut e = engine(0);
        e.monitors.push(Monitor {
            monitor_id: 2,
            device_name: "Right".into(),
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
            dpi_x: 144.,
            dpi_y: 144.,
        });
        e.process(event(0, -10, 10, EventType::Move), 500, (4, 4));
        e.process(event(25, 10, 10, EventType::Move), 500, (4, 4));
        assert_eq!(totals(&e).distance_px, 20.);
        assert_eq!(e.cell.unwrap().0, 2);
    }
    #[test]
    fn qualifying_efficiency_path() {
        let mut e = engine(0);
        for (t, x, k) in [
            (0, -100, EventType::ButtonDown),
            (10, -100, EventType::ButtonUp),
            (20, -70, EventType::Move),
            (30, -70, EventType::ButtonDown),
            (40, -70, EventType::ButtonUp),
        ] {
            e.process(event(t, x, 10, k), 500, (4, 4));
        }
        let s = totals(&e);
        assert_eq!(s.efficiency_count, 1);
        assert_eq!(s.efficiency_sum, 1.);
    }
}
