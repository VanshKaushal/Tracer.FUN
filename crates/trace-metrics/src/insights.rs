use trace_core::*;
#[derive(Default)]
pub struct InsightState {
    pub history: BarHistory,
    last_unsolicited: Option<i64>,
    last_day: String,
    previous_today: Stats,
    emitted: std::collections::BTreeSet<String>,
}
impl InsightState {
    pub fn consider(
        &mut self,
        now: i64,
        today: &Stats,
        session: Option<&Session>,
        settings: &BarSettings,
    ) -> Option<Insight> {
        let day = date_at(now);
        let changed = !self.last_day.is_empty() && self.last_day != day;
        if self.last_day != day {
            self.emitted.clear();
        }
        let summary = changed && self.previous_today.clicks() > 0;
        self.last_day = day.clone();
        self.previous_today = today.clone();
        if !settings.notifications
            || self
                .last_unsolicited
                .is_some_and(|last| now - last < 3600000)
        {
            return None;
        }
        let mut candidate = None;
        if summary {
            candidate = Some((
                "summary".to_string(),
                4,
                "Daily summary",
                "Your Trace day is ready.".to_string(),
                "/history",
            ));
        }
        if settings.personal_records && self.history.recorded_days >= 1 {
            if today.clicks() > self.history.max_daily_clicks && self.history.max_daily_clicks > 0 {
                candidate = Some((
                    format!("clicks-{day}"),
                    4,
                    "Personal record",
                    format!("{} clicks today · a new daily record", today.clicks()),
                    "/insights",
                ));
            } else if today.distance_px > self.history.max_daily_distance
                && self.history.max_daily_distance > 0.
            {
                candidate = Some((
                    format!("distance-{day}"),
                    4,
                    "Personal record",
                    "Your cursor has travelled farther than on any recorded day.".into(),
                    "/insights",
                ));
            }
            if let Some(s) = session {
                if self.history.longest_month_session_ms > 0
                    && s.stats.active_ms > self.history.longest_month_session_ms
                {
                    candidate = Some((
                        format!("session-{day}"),
                        4,
                        "Personal record",
                        "New longest session this month.".into(),
                        "/sessions",
                    ));
                }
            }
        }
        if self.history.recorded_days >= 14
            && self.history.weekday_days >= 2
            && self.history.weekday_clicks > 0.
        {
            let change = today.clicks() as f64 / self.history.weekday_clicks - 1.;
            if change >= 0.32
                && today.clicks() as f64
                    > self.history.weekday_clicks + 2. * self.history.weekday_clicks_stddev
            {
                candidate = Some((
                    format!("unusual-{day}"),
                    4,
                    "Unusual activity",
                    format!(
                        "Today's clicks are {:.0}% above your usual activity on this weekday.",
                        change * 100.
                    ),
                    "/insights",
                ));
            }
        }
        if let Some(s) = session {
            let key = format!("long-{}", s.id);
            if s.stats.active_ms >= 90 * 60000 && !self.emitted.contains(&key) {
                candidate = Some((
                    key,
                    3,
                    "Long session",
                    "You've been continuously active for 90 minutes.".into(),
                    "/sessions",
                ));
            }
        }
        let (id, priority, title, message, route) = candidate?;
        if !self.emitted.insert(id.clone()) {
            return None;
        }
        self.last_unsolicited = Some(now);
        Some(Insight {
            id,
            priority,
            title: title.into(),
            message,
            route: route.into(),
            expires_ts: now + 8000,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn insights_are_gated_throttled_and_not_repeated() {
        let mut state = InsightState::default();
        state.history.recorded_days = 14;
        state.history.max_daily_clicks = 100;
        let stats = Stats {
            left_clicks: 200,
            ..Default::default()
        };
        let now = now_ms();
        assert!(state
            .consider(
                now,
                &stats,
                None,
                &BarSettings {
                    notifications: false,
                    ..Default::default()
                }
            )
            .is_none());
        assert_eq!(
            state
                .consider(now, &stats, None, &BarSettings::default())
                .unwrap()
                .title,
            "Personal record"
        );
        assert!(state
            .consider(now + 1000, &stats, None, &BarSettings::default())
            .is_none());
        assert!(state
            .consider(now + 3600000, &stats, None, &BarSettings::default())
            .is_none());
    }
}
