### Fixed

- `HINDSIGHT_RETAIN_EVERY_N_TURNS`, `HINDSIGHT_RECALL_MAX_TOKENS`, `HINDSIGHT_RECALL_CONTEXT_TURNS` and `HINDSIGHT_RECALL_MAX_QUERY_CHARS` now accept only plain non-negative digits. Malformed values such as `5turns`, `1e3`, `1.5` or `-3` fall back to the matching `hindsight.*` setting instead of being read by `parseInt` as 5, 1, 1 or -3. A negative `HINDSIGHT_RETAIN_EVERY_N_TURNS` previously made chunked retention send nothing.
