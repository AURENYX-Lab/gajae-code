### Fixed

- Coordinator MCP: `GJC_COORDINATOR_MCP_ARTIFACT_BYTE_CAP`, `GJC_COORDINATOR_MCP_SESSION_IDLE_TTL_MS` and `GJC_COORDINATOR_MCP_SESSION_SWEEP_INTERVAL_MS` accept only plain decimal digits; values such as `64KB`, `1e6` or `1.5` now fall back to the default instead of being read as their leading digits (`64KB` used to set a 64-byte artifact cap).
