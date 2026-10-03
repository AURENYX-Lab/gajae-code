### Changed

- Cut startup memory for the light CLI invocations by deferring the per-path modules out of the eager root command graph: peak RSS dropped from 32.4 MB to 27.7 MB for `--version` and from 32.7 MB to 28.0 MB for `--help`. The quick lane, the bash-shell guardian/supervisor/worker executors, the isolated shell, the tab-worker smoke probe and the fixture report now load only when their own path actually runs, so their behaviour, output and exit codes are unchanged.
