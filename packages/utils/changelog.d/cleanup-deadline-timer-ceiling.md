### Fixed

- A `GJC_CLEANUP_DEADLINE_MS` above `2147483647` (about 24.9 days) no longer makes the exit-bound cleanup deadline expire at once. The deadline was passed straight to `setTimeout`, which treats longer delays as 1 ms, so shutdown skipped the cleanup it was meant to wait for; it is now capped at the timer maximum.
