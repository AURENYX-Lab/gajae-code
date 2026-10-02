### Fixed

- Codex websocket streams with an idle or first-event timeout above `2147483647` ms (about 24.9 days), such as `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS=99999999999` meant as "effectively never", no longer time out right after the request. `setTimeout` treats longer delays as 1 ms; the wait is now capped at the timer maximum.
