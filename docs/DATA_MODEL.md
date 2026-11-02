# Trace Bar data

Schema version 2 migrates existing version-1 databases transactionally. Original aggregates and settings are preserved. Unknown future versions are rejected.

Bar preferences live in the existing settings/config JSON under `trace_bar`: enabled, launch behavior, edge, monitor device name, offset, collapse, fullscreen behavior and overrides, visible statistics, focus controls, insights, and records. Missing fields in older settings receive defaults. Offsets must be finite and within 0–1.

The `focus_sessions` table stores id, start/end timestamps, last checkpoint, canonical aggregate JSON, and nullable context-switch counts. Generated columns expose active seconds, pixel distance, clicks, and scroll delta. Absolute focus snapshots are upserted, so retrying a flush does not double the counts. Recovery uses the last checkpoint as the end of an unfinished session. Focus history queries are limited to the most recent 1,000 overlapping sessions for a selected range.

Insights are transient, bounded state; no extra insight table is required. Incognito is temporary runtime state and its ignored events never reach telemetry tables.
