"""Keep queryable TRD columns alongside the compact typed aggregate representation."""
from pathlib import Path

fields = {
    'active_seconds': "COALESCE(json_extract(stats,'$.active_ms'),0)/1000.0",
    'idle_seconds': "COALESCE(json_extract(stats,'$.idle_ms'),0)/1000.0",
    **{key: f"COALESCE(json_extract(stats,'$.{key}'),0)" for key in [
        'distance_px', 'movement_samples', 'left_clicks', 'right_clicks', 'middle_clicks',
        'double_clicks', 'drag_count', 'scroll_delta', 'session_count']},
    'max_speed': "COALESCE(json_extract(stats,'$.max_speed'),0)",
    'peak_speed': "COALESCE(json_extract(stats,'$.max_speed'),0)",
    'average_speed': "COALESCE(json_extract(stats,'$.speed_sum')/NULLIF(json_extract(stats,'$.speed_count'),0),0)",
}
path = Path(__file__).resolve().parents[1] / 'migrations/001_initial.sql'
text = path.read_text()
marker = '\n-- Queryable aggregate columns'
text = text.split(marker)[0] + marker + ' (generated from canonical typed stats).\n'
for table in ['sessions', 'minute_stats', 'daily_stats']:
    for key, expr in fields.items():
        text += f'ALTER TABLE {table} ADD COLUMN {key} REAL GENERATED ALWAYS AS ({expr}) VIRTUAL;\n'
path.write_text(text)
