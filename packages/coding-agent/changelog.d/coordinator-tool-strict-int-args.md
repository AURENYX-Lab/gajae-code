### Fixed

- Coordinator MCP tool arguments `timeout_ms`, `poll_interval_ms`, `limit` and `lines`, and the `GJC_COORDINATOR_MCP_PROMPT_ACK_TIMEOUT_MS` env value, no longer read a leading digit prefix. A string such as `1e4` or `5s` became a 1 ms or 5 ms wait, and a one-element array such as `[50]` was accepted as `50`; strings must now be plain decimal digits and non-numeric types fall back to the defaults.
