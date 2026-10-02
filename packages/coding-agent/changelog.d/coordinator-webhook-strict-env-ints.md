### Fixed

- `GJC_COORDINATOR_MCP_EVENT_WEBHOOK_TIMEOUT_MS` and `GJC_COORDINATOR_MCP_EVENT_WEBHOOK_MAX_ATTEMPTS` now accept only plain decimal digits. Values such as `1.5`, `1e4` or `10s` were read as their leading digits, shrinking the per-attempt timeout to 1 ms or the retry budget to a single attempt; they now fall back to the defaults.
