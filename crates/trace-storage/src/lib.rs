use anyhow::{Context, Result};
use chrono::{Datelike, Days, Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};
use trace_core::*;

pub fn data_dir() -> Result<PathBuf> {
    let root = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("XDG_DATA_HOME"))
        .context("User app-data directory unavailable")?;
    Ok(PathBuf::from(root).join("Trace"))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Range {
    pub start: String,
    pub end: String,
}
impl Range {
    pub fn bounds(&self) -> Result<(i64, i64)> {
        let a = NaiveDate::parse_from_str(&self.start, "%Y-%m-%d")?;
        let b = NaiveDate::parse_from_str(&self.end, "%Y-%m-%d")?;
        anyhow::ensure!(
            a.year() >= 1970 && b.year() <= 9999,
            "Dates must be between 1970 and 9999"
        );
        anyhow::ensure!(a <= b, "Start must precede end");
        anyhow::ensure!(
            (b - a).num_days() <= 3660,
            "Range must be at most ten years"
        );
        let start = Local
            .from_local_datetime(&a.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .context("Invalid local start date")?
            .timestamp_millis();
        let end = Local
            .from_local_datetime(
                &b.checked_add_days(Days::new(1))
                    .context("Date overflow")?
                    .and_hms_opt(0, 0, 0)
                    .unwrap(),
            )
            .earliest()
            .context("Invalid local end date")?
            .timestamp_millis();
        Ok((start, end))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DatedStats {
    pub date: String,
    pub stats: Stats,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimedStats {
    pub timestamp: i64,
    pub stats: Stats,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub metric: String,
    pub date: String,
    pub value: f64,
    pub unit: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Deviation {
    pub metric: String,
    pub standard_deviations: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Dashboard {
    pub daily: Vec<DatedStats>,
    pub timeline: Vec<TimedStats>,
    pub sessions: Vec<Session>,
    pub heatmap: Vec<HeatCell>,
    pub monitors: Vec<Monitor>,
    pub baseline: Stats,
    pub baseline_days: usize,
    pub weekly: Stats,
    pub weekly_range: Range,
    pub records: Vec<Record>,
    pub deviations: Vec<Deviation>,
}
pub struct Store {
    pub conn: Connection,
}
type MetricProjection = (&'static str, fn(&Stats) -> f64);
// Sparse storage saves zero-only JSON fields; wire responses retain the full typed contract.
fn encode_stats(stats: &Stats) -> Result<String> {
    let mut value = serde_json::to_value(stats)?;
    if let Some(fields) = value.as_object_mut() {
        fields.retain(|_, v| match v {
            serde_json::Value::Number(n) => n.as_f64() != Some(0.),
            serde_json::Value::Array(a) => a.iter().any(|n| n.as_u64() != Some(0)),
            _ => true,
        });
    }
    Ok(serde_json::to_string(&value)?)
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(p) = path.as_ref().parent() {
            if !p.as_os_str().is_empty() {
                std::fs::create_dir_all(p)?;
            }
        }
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_millis(500))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='schema_version')",
            [],
            |r| r.get(0),
        )?;
        if !exists {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../../../migrations/001_initial.sql"))?;
            tx.commit()?;
        }
        let version: i64 =
            conn.query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))?;
        anyhow::ensure!(
            (1..=2).contains(&version),
            "Unsupported database schema {version}"
        );
        if version == 1 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../../../migrations/002_trace_bar.sql"))?;
            tx.commit()?;
        }
        Ok(Self { conn })
    }
    pub fn settings(&self) -> Result<Settings> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key='config'", [], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(match v {
            Some(s) => serde_json::from_str(&s)?,
            None => Settings::default(),
        })
    }
    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        s.validate()?;
        self.conn.execute("INSERT INTO settings VALUES('config',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(s)?])?;
        Ok(())
    }
    pub fn recover_sessions(&self, now: i64) -> Result<i64> {
        self.conn.execute("UPDATE focus_sessions SET end_ts=MAX(start_ts,MIN(updated_ts,?1)) WHERE end_ts IS NULL", [now])?;
        // A crash cannot leave a session falsely active. Its last persisted duration bounds its end.
        let mut stmt = self
            .conn
            .prepare("SELECT id,start_ts,stats FROM sessions WHERE end_ts IS NULL")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, start, json) in rows {
            let s: Stats = serde_json::from_str(&json)?;
            self.conn.execute(
                "UPDATE sessions SET end_ts=?1 WHERE id=?2",
                params![(start + s.active_ms).min(now).max(start), id],
            )?;
        }
        Ok(self
            .conn
            .query_row("SELECT COALESCE(MAX(id),0) FROM sessions", [], |r| r.get(0))?)
    }
    pub fn flush(&mut self, b: &Batch, monitors: &[Monitor], now: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        for (&minute, stats) in &b.minutes {
            let date = date_at(minute);
            let hour = hour_at(minute);
            let existing: Option<String> = tx
                .query_row(
                    "SELECT stats FROM minute_stats WHERE minute_ts=?1",
                    [minute],
                    |r| r.get(0),
                )
                .optional()?;
            let mut total: Stats = existing
                .map(|v| serde_json::from_str(&v))
                .transpose()?
                .unwrap_or_default();
            total.merge(stats);
            tx.execute("INSERT INTO minute_stats(minute_ts,date,stats) VALUES(?1,?2,?3) ON CONFLICT(minute_ts) DO UPDATE SET stats=excluded.stats",params![minute,date,encode_stats(&total)?])?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT stats FROM hourly_stats WHERE hour_start=?1 AND date=?2",
                    params![hour, date],
                    |r| r.get(0),
                )
                .optional()?;
            let mut total: Stats = old
                .map(|v| serde_json::from_str(&v))
                .transpose()?
                .unwrap_or_default();
            total.merge(stats);
            tx.execute("INSERT INTO hourly_stats VALUES(?1,?2,?3) ON CONFLICT(hour_start,date) DO UPDATE SET stats=excluded.stats",params![hour,date,encode_stats(&total)?])?;
            let old: Option<String> = tx
                .query_row(
                    "SELECT stats FROM daily_stats WHERE date=?1",
                    [&date],
                    |r| r.get(0),
                )
                .optional()?;
            let mut total: Stats = old
                .map(|v| serde_json::from_str(&v))
                .transpose()?
                .unwrap_or_default();
            total.merge(stats);
            tx.execute("INSERT INTO daily_stats(date,stats) VALUES(?1,?2) ON CONFLICT(date) DO UPDATE SET stats=excluded.stats",params![date,encode_stats(&total)?])?;
        }
        for h in b.heat.values() {
            tx.execute("INSERT INTO heatmap_hourly VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(hour_start,date,monitor_id,grid_x,grid_y) DO UPDATE SET dwell_count=dwell_count+excluded.dwell_count,click_count=click_count+excluded.click_count,left_clicks=left_clicks+excluded.left_clicks,right_clicks=right_clicks+excluded.right_clicks,middle_clicks=middle_clicks+excluded.middle_clicks,scroll_count=scroll_count+excluded.scroll_count,drag_count=drag_count+excluded.drag_count",
                params![h.hour_start,date_at(h.hour_start),h.monitor_id,h.grid_x,h.grid_y,h.dwell_ms,h.left_clicks+h.right_clicks+h.middle_clicks,h.left_clicks,h.right_clicks,h.middle_clicks,h.scroll_count,h.drag_count])?;
        }
        for s in b.sessions.values() {
            tx.execute("INSERT INTO sessions(id,start_ts,end_ts,stats) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET end_ts=excluded.end_ts,stats=excluded.stats",params![s.id,s.start_ts,s.end_ts,encode_stats(&s.stats)?])?;
        }
        for s in b.focus_sessions.values() {
            tx.execute("INSERT INTO focus_sessions(id,start_ts,end_ts,updated_ts,stats,context_switches) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET end_ts=excluded.end_ts,updated_ts=excluded.updated_ts,stats=excluded.stats,context_switches=excluded.context_switches", params![s.id,s.start_ts,s.end_ts,s.updated_ts,encode_stats(&s.stats)?,s.context_switches])?;
        }
        for ((id, day), s) in &b.session_days {
            let old: Option<String> = tx
                .query_row(
                    "SELECT stats FROM session_days WHERE id=?1 AND date=?2",
                    params![id, date_at(*day)],
                    |r| r.get(0),
                )
                .optional()?;
            let mut total: Stats = old
                .map(|v| serde_json::from_str(&v))
                .transpose()?
                .unwrap_or_default();
            total.merge(&s.stats);
            tx.execute("INSERT INTO session_days VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id,date) DO UPDATE SET end_ts=MAX(end_ts,excluded.end_ts),stats=excluded.stats",params![id,date_at(*day),s.start_ts,s.end_ts,encode_stats(&total)?])?;
        }
        for e in &b.raw {
            tx.execute("INSERT INTO raw_events(ts,event_type,x_norm,y_norm,monitor_id) VALUES(?1,?2,?3,?4,?5)",params![e.ts,e.event_type,e.x_norm,e.y_norm,e.monitor_id])?;
        }
        for m in monitors {
            tx.execute("INSERT INTO monitors VALUES(?1,?2,?3,?4,?5,?6,?7,?7,?8) ON CONFLICT(monitor_id) DO UPDATE SET width=excluded.width,height=excluded.height,dpi_x=excluded.dpi_x,dpi_y=excluded.dpi_y,last_seen=excluded.last_seen,metadata=excluded.metadata",params![m.monitor_id,m.device_name,m.width,m.height,m.dpi_x,m.dpi_y,now,serde_json::to_string(m)?])?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn daily(&self, r: &Range) -> Result<Vec<DatedStats>> {
        r.bounds()?;
        let mut st = self.conn.prepare(
            "SELECT date,stats FROM daily_stats WHERE date BETWEEN ?1 AND ?2 ORDER BY date",
        )?;
        let rows = st.query_map(params![r.start, r.end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.map(|row| {
            let (d, s) = row?;
            Ok(DatedStats {
                date: d,
                stats: serde_json::from_str(&s)?,
            })
        })
        .collect()
    }
    pub fn sessions(&self, r: &Range) -> Result<Vec<Session>> {
        let (a, b) = r.bounds()?;
        let mut st=self.conn.prepare("SELECT id,start_ts,end_ts,stats FROM sessions WHERE start_ts<?2 AND COALESCE(end_ts,?2)>=?1 ORDER BY start_ts DESC")?;
        let rows = st.query_map(params![a, b], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        rows.map(|row| {
            let (id, start_ts, end_ts, s) = row?;
            Ok(Session {
                id,
                start_ts,
                end_ts,
                stats: serde_json::from_str(&s)?,
            })
        })
        .collect()
    }
    pub fn next_focus_id(&self) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(id),0)+1 FROM focus_sessions",
            [],
            |r| r.get(0),
        )?)
    }
    pub fn bar_history(&self, now: i64) -> Result<BarHistory> {
        let today = date_at(now);
        let rows = self.daily(&Range {
            start: date_at(now - 90 * 86400000),
            end: date_at(now - 86400000),
        })?;
        let weekday = NaiveDate::parse_from_str(&today, "%Y-%m-%d")?.weekday();
        let mut history = BarHistory {
            recorded_days: rows.len(),
            ..Default::default()
        };
        let (record_clicks,record_distance,days) = self.conn.query_row("SELECT CAST(COALESCE(MAX(left_clicks+right_clicks+middle_clicks),0) AS INTEGER),COALESCE(MAX(distance_px),0),COUNT(*) FROM daily_stats WHERE date<?1",[&today],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,f64>(1)?,r.get::<_,usize>(2)?)))?;
        history.max_daily_clicks = record_clicks;
        history.max_daily_distance = record_distance;
        history.recorded_days = days;
        let mut weekday_clicks = Vec::new();
        for d in rows {
            history.max_daily_clicks = history.max_daily_clicks.max(d.stats.clicks());
            history.max_daily_distance = history.max_daily_distance.max(d.stats.distance_px);
            if NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")?.weekday() == weekday {
                weekday_clicks.push(d.stats.clicks() as f64);
            }
        }
        history.weekday_days = weekday_clicks.len();
        if !weekday_clicks.is_empty() {
            history.weekday_clicks =
                weekday_clicks.iter().sum::<f64>() / weekday_clicks.len() as f64;
            history.weekday_clicks_stddev = (weekday_clicks
                .iter()
                .map(|c| (c - history.weekday_clicks).powi(2))
                .sum::<f64>()
                / weekday_clicks.len() as f64)
                .sqrt();
        }
        let month = format!("{}-01", &today[..7]);
        history.longest_month_session_ms = self
            .sessions(&Range {
                start: month,
                end: today,
            })?
            .into_iter()
            .filter(|s| s.end_ts.is_some())
            .map(|s| s.stats.active_ms)
            .max()
            .unwrap_or(0);
        Ok(history)
    }
    pub fn focus_sessions(&self, range: &Range) -> Result<Vec<FocusSession>> {
        let (a, b) = range.bounds()?;
        let mut stmt = self.conn.prepare("SELECT id,start_ts,end_ts,updated_ts,stats,context_switches FROM focus_sessions WHERE start_ts<?2 AND COALESCE(end_ts,?2)>=?1 ORDER BY start_ts DESC LIMIT 1000")?;
        let rows = stmt.query_map(params![a, b], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get::<_, String>(4)?,
                r.get(5)?,
            ))
        })?;
        rows.map(|row| {
            let (id, start_ts, end_ts, updated_ts, stats, context_switches) = row?;
            Ok(FocusSession {
                id,
                start_ts,
                end_ts,
                updated_ts,
                stats: serde_json::from_str(&stats)?,
                context_switches,
            })
        })
        .collect()
    }
    pub fn dashboard(&self, r: &Range, monitor: Option<u16>) -> Result<Dashboard> {
        r.bounds()?;
        let daily = self.daily(r)?;
        let mut stmt=self.conn.prepare("SELECT hour_start,stats FROM hourly_stats WHERE date BETWEEN ?1 AND ?2 ORDER BY hour_start")?;
        let timeline = stmt
            .query_map(params![r.start, r.end], |row| {
                Ok((row.get(0)?, row.get::<_, String>(1)?))
            })?
            .map(|v| {
                let (timestamp, s) = v?;
                Ok(TimedStats {
                    timestamp,
                    stats: serde_json::from_str(&s)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut st=self.conn.prepare("SELECT monitor_id,grid_x,grid_y,SUM(dwell_count),SUM(left_clicks),SUM(right_clicks),SUM(middle_clicks),SUM(scroll_count),SUM(drag_count) FROM heatmap_hourly WHERE date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR monitor_id=?3) GROUP BY monitor_id,grid_x,grid_y")?;
        let heatmap = st
            .query_map(params![r.start, r.end, monitor], |row| {
                Ok(HeatCell {
                    hour_start: 0,
                    monitor_id: row.get(0)?,
                    grid_x: row.get(1)?,
                    grid_y: row.get(2)?,
                    dwell_ms: row.get(3)?,
                    left_clicks: row.get(4)?,
                    right_clicks: row.get(5)?,
                    middle_clicks: row.get(6)?,
                    scroll_count: row.get(7)?,
                    drag_count: row.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut st = self
            .conn
            .prepare("SELECT metadata FROM monitors ORDER BY monitor_id")?;
        let monitors = st
            .query_map([], |row| row.get::<_, String>(0))?
            .map(|s| Ok(serde_json::from_str(&s?)?))
            .collect::<Result<Vec<_>>>()?;
        let end = NaiveDate::parse_from_str(&r.start, "%Y-%m-%d")?;
        let base = Range {
            start: (end - Days::new(30)).to_string(),
            end: (end - Days::new(1)).to_string(),
        };
        let days = self.daily(&base)?;
        let mut baseline = Stats::default();
        for d in &days {
            baseline.merge(&d.stats);
        }
        let week_end = NaiveDate::parse_from_str(&r.end, "%Y-%m-%d")?;
        let weekly_range = Range {
            start: (week_end - Days::new(6)).to_string(),
            end: r.end.clone(),
        };
        let mut weekly = Stats::default();
        for d in self.daily(&weekly_range)? {
            weekly.merge(&d.stats);
        }
        let mut records = Vec::new();
        for (metric, expr, unit) in [
            (
                "Most clicks in a day",
                "left_clicks+right_clicks+middle_clicks",
                "clicks",
            ),
            ("Longest daily cursor distance", "distance_px", "px"),
            (
                "Highest scrolling day",
                "COALESCE(json_extract(stats,'$.scroll_abs_delta'),0)/120.0",
                "steps",
            ),
        ] {
            let row: Option<(String, f64)> = self
                .conn
                .query_row(
                    &format!("SELECT date,{expr} FROM daily_stats ORDER BY {expr} DESC LIMIT 1"),
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((date, value)) = row {
                records.push(Record {
                    metric: metric.into(),
                    date,
                    value,
                    unit: unit.into(),
                });
            }
        }
        let longest: Option<(i64, f64)> = self
            .conn
            .query_row(
                "SELECT start_ts,active_seconds FROM sessions ORDER BY active_seconds DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((ts, value)) = longest {
            records.push(Record {
                metric: "Longest active session".into(),
                date: date_at(ts),
                value,
                unit: "seconds".into(),
            });
        }
        let busiest:Option<(i64,f64)>=self.conn.query_row("SELECT hour_start,COALESCE(json_extract(stats,'$.movement_samples'),0)+COALESCE(json_extract(stats,'$.left_clicks'),0)+COALESCE(json_extract(stats,'$.right_clicks'),0)+COALESCE(json_extract(stats,'$.middle_clicks'),0)+COALESCE(json_extract(stats,'$.scroll_events'),0) AS activity FROM hourly_stats ORDER BY activity DESC LIMIT 1",[],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
        if let Some((ts, value)) = busiest {
            records.push(Record {
                metric: format!(
                    "Most active hour ({} local)",
                    Local
                        .timestamp_millis_opt(ts)
                        .single()
                        .unwrap()
                        .format("%H:%M")
                ),
                date: date_at(ts),
                value,
                unit: "sampled interactions".into(),
            });
        }
        let mut deviations = Vec::new();
        if days.len() >= 14 {
            let metrics: [MetricProjection; 5] = [
                ("Clicks", |s| s.clicks() as f64),
                ("Cursor distance", |s| s.distance_px),
                ("Active time", |s| s.active_ms as f64),
                ("Scroll steps", |s| s.scroll_abs_delta as f64 / 120.),
                ("Sessions", |s| s.session_count as f64),
            ];
            let count_days =
                (week_end - NaiveDate::parse_from_str(&r.start, "%Y-%m-%d")?).num_days() + 1;
            for (metric, get) in metrics {
                let mean = days.iter().map(|d| get(&d.stats)).sum::<f64>() / days.len() as f64;
                let sd = (days
                    .iter()
                    .map(|d| (get(&d.stats) - mean).powi(2))
                    .sum::<f64>()
                    / (days.len() - 1) as f64)
                    .sqrt();
                let selected = daily.iter().map(|d| get(&d.stats)).sum::<f64>() / count_days as f64;
                if sd > 0. {
                    let z = (selected - mean) / sd;
                    if z.abs() >= 2. {
                        deviations.push(Deviation {
                            metric: metric.into(),
                            standard_deviations: z,
                        });
                    }
                }
            }
        }
        Ok(Dashboard {
            daily,
            timeline,
            sessions: self.sessions(r)?,
            heatmap,
            monitors,
            baseline,
            baseline_days: days.len(),
            weekly,
            weekly_range,
            records,
            deviations,
        })
    }
    pub fn maintain(&self, now: i64, s: &Settings) -> Result<()> {
        self.trim_raw(now, s)?;
        self.conn.execute(
            "DELETE FROM minute_stats WHERE minute_ts<?1",
            [now - s.minute_retention_days * 86400000],
        )?;
        Ok(())
    }
    pub fn trim_raw(&self, now: i64, s: &Settings) -> Result<()> {
        self.conn.execute(
            "DELETE FROM raw_events WHERE ts<?1",
            [now - s.raw_retention_hours * 3600000],
        )?;
        Ok(())
    }
    pub fn delete(&mut self, r: &Range) -> Result<()> {
        let (a, b) = r.bounds()?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM focus_sessions WHERE start_ts<?2 AND COALESCE(end_ts,?2)>=?1",
            params![a, b],
        )?;
        for table in [
            "minute_stats",
            "hourly_stats",
            "daily_stats",
            "heatmap_hourly",
        ] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE date BETWEEN ?1 AND ?2"),
                params![r.start, r.end],
            )?;
        }
        tx.execute(
            "DELETE FROM raw_events WHERE ts>=?1 AND ts<?2",
            params![a, b],
        )?;
        let ids = {
            let mut st = tx
                .prepare("SELECT id FROM sessions WHERE start_ts<?2 AND COALESCE(end_ts,?2)>=?1")?;
            let rows = st
                .query_map(params![a, b], |r| r.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        tx.execute(
            "DELETE FROM session_days WHERE date BETWEEN ?1 AND ?2",
            params![r.start, r.end],
        )?;
        for id in ids {
            let remaining = {
                let mut st = tx.prepare(
                    "SELECT start_ts,end_ts,stats FROM session_days WHERE id=?1 ORDER BY date",
                )?;
                let rows = st
                    .query_map([id], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            };
            if remaining.is_empty() {
                tx.execute("DELETE FROM sessions WHERE id=?1", [id])?;
            } else {
                let mut total = Stats::default();
                for (_, _, s) in &remaining {
                    total.merge(&serde_json::from_str::<Stats>(s)?);
                }
                tx.execute(
                    "UPDATE sessions SET start_ts=?1,end_ts=?2,stats=?3 WHERE id=?4",
                    params![
                        remaining[0].0,
                        remaining.last().unwrap().1,
                        encode_stats(&total)?,
                        id
                    ],
                )?;
            }
        }
        tx.commit()?;
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }
    pub fn export(&self, format: &str, r: &Range) -> Result<BTreeMap<String, String>> {
        let mut files = BTreeMap::new();
        let daily = self.daily(r)?;
        let sessions = self.sessions(r)?;
        if format == "json" {
            files.insert("trace.json".into(),serde_json::to_string_pretty(&serde_json::json!({"schema_version":2,"range":r,"daily":daily,"sessions":sessions,"focus_sessions":self.focus_sessions(r)?}))?);
        } else if format == "csv" {
            let mut writer = csv::Writer::from_writer(vec![]);
            writer.write_record([
                "date",
                "active_seconds",
                "idle_seconds",
                "distance_px",
                "left_clicks",
                "right_clicks",
                "middle_clicks",
                "double_clicks",
                "drag_count",
                "scroll_delta",
                "horizontal_scroll_delta",
                "scroll_steps",
                "session_count",
                "average_speed",
                "peak_speed",
            ])?;
            for d in daily {
                let s = d.stats;
                writer.write_record([
                    d.date,
                    (s.active_ms as f64 / 1000.).to_string(),
                    (s.idle_ms as f64 / 1000.).to_string(),
                    s.distance_px.to_string(),
                    s.left_clicks.to_string(),
                    s.right_clicks.to_string(),
                    s.middle_clicks.to_string(),
                    s.double_clicks.to_string(),
                    s.drag_count.to_string(),
                    s.scroll_delta.to_string(),
                    s.horizontal_scroll_delta.to_string(),
                    (s.scroll_abs_delta as f64 / 120.).to_string(),
                    s.session_count.to_string(),
                    (s.speed_sum / s.speed_count.max(1) as f64).to_string(),
                    s.max_speed.to_string(),
                ])?;
            }
            files.insert("daily.csv".into(), String::from_utf8(writer.into_inner()?)?);
            let mut writer = csv::Writer::from_writer(vec![]);
            writer.write_record([
                "id",
                "start_ts",
                "end_ts",
                "active_seconds",
                "distance_px",
                "clicks",
                "scroll_steps",
                "average_speed",
            ])?;
            for s in sessions {
                writer.write_record([
                    s.id.to_string(),
                    s.start_ts.to_string(),
                    s.end_ts.map(|v| v.to_string()).unwrap_or_default(),
                    (s.stats.active_ms as f64 / 1000.).to_string(),
                    s.stats.distance_px.to_string(),
                    s.stats.clicks().to_string(),
                    (s.stats.scroll_abs_delta as f64 / 120.).to_string(),
                    (s.stats.speed_sum / s.stats.speed_count.max(1) as f64).to_string(),
                ])?;
            }
            files.insert(
                "sessions.csv".into(),
                String::from_utf8(writer.into_inner()?)?,
            );
            let mut writer = csv::Writer::from_writer(vec![]);
            writer.write_record([
                "minute_ts",
                "active_seconds",
                "distance_px",
                "clicks",
                "scroll_steps",
            ])?;
            let mut st=self.conn.prepare("SELECT minute_ts,stats FROM minute_stats WHERE date BETWEEN ?1 AND ?2 ORDER BY minute_ts")?;
            for v in st.query_map(params![r.start, r.end], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })? {
                let (t, s) = v?;
                let s: Stats = serde_json::from_str(&s)?;
                writer.write_record([
                    t.to_string(),
                    (s.active_ms as f64 / 1000.).to_string(),
                    s.distance_px.to_string(),
                    s.clicks().to_string(),
                    (s.scroll_abs_delta as f64 / 120.).to_string(),
                ])?;
            }
            files.insert(
                "minute_stats.csv".into(),
                String::from_utf8(writer.into_inner()?)?,
            );
        } else {
            anyhow::bail!("Export format must be csv or json");
        }
        Ok(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bar_history_uses_prior_days_and_all_time_records() -> Result<()> {
        let mut db = Store::open(":memory:")?;
        let date = Range {
            start: "2026-10-02".into(),
            end: "2026-10-02".into(),
        };
        let start = date.bounds()?.0;
        let mut batch = Batch::default();
        batch.minutes.insert(
            start,
            Stats {
                left_clicks: 30,
                right_clicks: 2,
                distance_px: 200.,
                ..Default::default()
            },
        );
        batch.minutes.insert(
            start + 86400000,
            Stats {
                left_clicks: 999,
                ..Default::default()
            },
        );
        db.flush(&batch, &[], start + 86400000)?;
        let history = db.bar_history(start + 86400000)?;
        assert_eq!(history.max_daily_clicks, 32);
        assert_eq!(history.max_daily_distance, 200.);
        assert_eq!(history.recorded_days, 1);
        Ok(())
    }
    #[test]
    fn focus_history_recovery_export_and_date_deletion() -> Result<()> {
        let mut db = Store::open(":memory:")?;
        let range = Range {
            start: "2026-10-03".into(),
            end: "2026-10-03".into(),
        };
        let start = range.bounds()?.0;
        let mut batch = Batch::default();
        batch.focus_sessions.insert(
            1,
            FocusSession {
                id: 1,
                start_ts: start,
                end_ts: None,
                updated_ts: start + 2000,
                stats: Stats {
                    left_clicks: 7,
                    distance_px: 96.,
                    ..Default::default()
                },
                context_switches: None,
            },
        );
        db.flush(&batch, &[], start + 2000)?;
        db.flush(&batch, &[], start + 2000)?;
        let rows = db.focus_sessions(&range)?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stats.left_clicks, 7);
        assert_eq!(db.next_focus_id()?, 2);
        db.recover_sessions(start + 100000)?;
        assert_eq!(db.focus_sessions(&range)?[0].end_ts, Some(start + 2000));
        assert!(db.export("json", &range)?["trace.json"].contains("focus_sessions"));
        db.delete(&range)?;
        assert!(db.focus_sessions(&range)?.is_empty());
        Ok(())
    }
    #[test]
    fn persistence_export_delete_retention() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("trace.db");
        let mut db = Store::open(&path)?;
        let range = Range {
            start: "2026-10-01".into(),
            end: "2026-10-01".into(),
        };
        let (t, _) = range.bounds()?;
        let mut batch = Batch::default();
        batch.minutes.insert(
            t,
            Stats {
                distance_px: 5.,
                left_clicks: 2,
                scroll_abs_delta: 240,
                ..Stats::default()
            },
        );
        batch.sessions.insert(
            1,
            Session {
                id: 1,
                start_ts: t,
                end_ts: None,
                stats: Stats {
                    active_ms: 1000,
                    ..Stats::default()
                },
            },
        );
        batch.raw.push(RawEvent {
            ts: t,
            event_type: "click".into(),
            x_norm: 0.5,
            y_norm: 0.5,
            monitor_id: 1,
        });
        db.flush(&batch, &[], t)?;
        drop(db);
        let mut db = Store::open(&path)?;
        assert_eq!(db.daily(&range)?[0].stats.distance_px, 5.);
        assert_eq!(db.recover_sessions(t + 2000)?, 1);
        assert_eq!(db.sessions(&range)?[0].end_ts, Some(t + 1000));
        assert!(db.export("csv", &range)?["daily.csv"].contains("scroll_steps"));
        db.maintain(t + 31 * 86400000, &Settings::default())?;
        assert_eq!(db.dashboard(&range, None)?.timeline.len(), 1);
        db.delete(&range)?;
        assert!(db.daily(&range)?.is_empty());
        assert!(db.sessions(&range)?.is_empty());
        Ok(())
    }
    #[test]
    fn transactional_flush_rollback() -> Result<()> {
        let mut db = Store::open(":memory:")?;
        let mut batch = Batch::default();
        batch.minutes.insert(
            0,
            Stats {
                left_clicks: 1,
                ..Stats::default()
            },
        );
        batch.heat.insert(
            (0, 1, 64, 0),
            HeatCell {
                grid_x: 64,
                ..HeatCell::default()
            },
        );
        assert!(db.flush(&batch, &[], 0).is_err());
        assert_eq!(
            db.conn
                .query_row("SELECT COUNT(*) FROM daily_stats", [], |r| r
                    .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }
    #[test]
    fn midnight_session_deletion_preserves_other_day() -> Result<()> {
        use trace_metrics::Engine;
        let range = Range {
            start: "2026-10-02".into(),
            end: "2026-10-02".into(),
        };
        let (midnight, _) = range.bounds()?;
        let settings = Settings {
            tracking_enabled: true,
            ..Default::default()
        };
        let monitor = Monitor {
            monitor_id: 1,
            device_name: "Display".into(),
            left: -100,
            top: 0,
            width: 100,
            height: 100,
            dpi_x: 96.,
            dpi_y: 96.,
        };
        let mut engine = Engine::new(settings, vec![monitor], midnight - 2000, 0);
        for (t, kind, x) in [
            (midnight - 2000, EventType::Move, -50),
            (midnight - 1000, EventType::ButtonDown, -50),
            (midnight - 900, EventType::ButtonUp, -50),
            (midnight + 1000, EventType::Move, -20),
        ] {
            engine.process(
                PointerEvent {
                    timestamp_ms: t,
                    event_type: kind,
                    x,
                    y: 20,
                    wheel_delta: 0,
                    button: if matches!(kind, EventType::ButtonDown | EventType::ButtonUp) {
                        Some(MouseButton::Left)
                    } else {
                        None
                    },
                },
                500,
                (4, 4),
            );
        }
        engine.suspend(midnight + 2000);
        let mut db = Store::open(":memory:")?;
        db.flush(&engine.pending, &engine.monitors, midnight + 2000)?;
        assert_eq!(db.daily(&range)?[0].stats.active_ms, 2000);
        assert_eq!(
            db.dashboard(&range, None)?
                .heatmap
                .iter()
                .map(|h| h.dwell_ms)
                .sum::<i64>(),
            2000
        );
        db.delete(&range)?;
        let previous = Range {
            start: "2026-10-01".into(),
            end: "2026-10-01".into(),
        };
        assert_eq!(db.daily(&previous)?[0].stats.left_clicks, 1);
        let s = &db.sessions(&previous)?[0];
        assert_eq!(s.stats.active_ms, 2000);
        assert_eq!(s.stats.left_clicks, 1);
        assert_eq!(s.end_ts, Some(midnight));
        assert!(db.dashboard(&range, None)?.heatmap.is_empty());
        Ok(())
    }
    #[test]
    fn locked_database_does_not_consume_batch() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("locked.db");
        let mut db = Store::open(&path)?;
        let other = Store::open(&path)?;
        other.conn.execute_batch("BEGIN IMMEDIATE;")?;
        let mut b = Batch::default();
        b.minutes.insert(
            0,
            Stats {
                right_clicks: 1,
                ..Stats::default()
            },
        );
        assert!(db.flush(&b, &[], 0).is_err());
        assert_eq!(b.minutes[&0].right_clicks, 1);
        other.conn.execute_batch("ROLLBACK;")?;
        db.flush(&b, &[], 0)?;
        assert_eq!(
            db.conn
                .query_row("SELECT right_clicks FROM daily_stats", [], |r| r
                    .get::<_, f64>(0))?,
            1.
        );
        Ok(())
    }
    #[test]
    fn baselines_records_and_weekly_totals() -> Result<()> {
        let mut db = Store::open(":memory:")?;
        let range = Range {
            start: "2026-10-01".into(),
            end: "2026-10-01".into(),
        };
        let mut b = Batch::default();
        for day in 1..=14 {
            let r = Range {
                start: format!("2026-09-{day:02}"),
                end: format!("2026-09-{day:02}"),
            };
            b.minutes.insert(
                r.bounds()?.0,
                Stats {
                    left_clicks: 10 + day % 3,
                    distance_px: day as f64,
                    ..Stats::default()
                },
            );
        }
        let now = range.bounds()?.0;
        b.minutes.insert(
            now,
            Stats {
                left_clicks: 1000,
                distance_px: 5000.,
                ..Stats::default()
            },
        );
        db.flush(&b, &[], now)?;
        let data = db.dashboard(&range, None)?;
        assert_eq!(data.baseline_days, 14);
        assert_eq!(data.weekly.left_clicks, 1000);
        assert_eq!(data.weekly_range.start, "2026-09-25");
        assert!(data
            .deviations
            .iter()
            .any(|d| d.metric == "Clicks" && d.standard_deviations > 2.));
        assert_eq!(
            data.records
                .iter()
                .find(|r| r.metric == "Most clicks in a day")
                .unwrap()
                .date,
            "2026-10-01"
        );
        Ok(())
    }
    #[test]
    fn simulated_three_day_session_has_bounded_buffers_and_daily_totals() -> Result<()> {
        let range = Range {
            start: "2026-10-01".into(),
            end: "2026-10-03".into(),
        };
        let start = range.bounds()?.0;
        let settings = Settings {
            tracking_enabled: true,
            ..Settings::default()
        };
        let monitor = Monitor {
            monitor_id: 1,
            device_name: "Display".into(),
            left: -100,
            top: 0,
            width: 100,
            height: 100,
            dpi_x: 96.,
            dpi_y: 96.,
        };
        let mut engine = trace_metrics::Engine::new(settings, vec![monitor], start, 0);
        let mut db = Store::open(":memory:")?;
        for second in 0..259200 {
            engine.process(
                PointerEvent {
                    timestamp_ms: start + second * 1000,
                    event_type: EventType::Move,
                    x: -50 + (second % 2) as i32,
                    y: 20,
                    wheel_delta: 0,
                    button: None,
                },
                500,
                (4, 4),
            );
            if second % 3600 == 3599 {
                assert!(engine.pending.minutes.len() < 120);
                assert!(engine.pending.heat.len() <= 4608);
                assert_eq!(engine.pending.raw.len(), 0);
                engine.checkpoint();
                db.flush(&engine.pending, &engine.monitors, start + second * 1000)?;
                engine.clear_pending();
            }
        }
        engine.suspend(start + 259200000);
        db.flush(&engine.pending, &engine.monitors, start + 259200000)?;
        let daily = db.daily(&range)?;
        assert_eq!(daily.len(), 3);
        assert_eq!(
            daily.iter().map(|d| d.stats.active_ms).sum::<i64>(),
            259200000
        );
        assert_eq!(
            daily.iter().map(|d| d.stats.distance_px).sum::<f64>(),
            259199.
        );
        assert_eq!(db.sessions(&range)?.len(), 1);
        Ok(())
    }
}
