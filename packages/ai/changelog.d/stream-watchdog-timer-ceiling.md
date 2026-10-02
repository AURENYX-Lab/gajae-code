### Fixed

- Stream idle and first-event watchdogs with a timeout above `2147483647` ms (about 24.9 days), such as `PI_STREAM_IDLE_TIMEOUT_MS=99999999999` meant as "effectively never", no longer abort the stream right away. `setTimeout` treats longer delays as 1 ms; the watchdog delay is now capped at the timer maximum. `0` still disables the watchdog.
