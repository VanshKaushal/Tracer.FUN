CREATE TABLE focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    updated_ts INTEGER NOT NULL,
    stats TEXT NOT NULL,
    context_switches INTEGER,
    active_seconds REAL GENERATED ALWAYS AS (COALESCE(json_extract(stats,'$.active_ms'),0)/1000.0) VIRTUAL,
    distance_px REAL GENERATED ALWAYS AS (COALESCE(json_extract(stats,'$.distance_px'),0)) VIRTUAL,
    left_clicks INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(stats,'$.left_clicks'),0)) VIRTUAL,
    right_clicks INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(stats,'$.right_clicks'),0)) VIRTUAL,
    scroll_delta INTEGER GENERATED ALWAYS AS (COALESCE(json_extract(stats,'$.scroll_delta'),0)) VIRTUAL
);
CREATE INDEX idx_focus_start ON focus_sessions(start_ts);
INSERT INTO schema_version VALUES (2);
