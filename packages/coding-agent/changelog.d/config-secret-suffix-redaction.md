### Fixed

- `gjc config set|get|list` (text and `--json`) no longer print the Slack app-level token `notifications.slack.appToken` verbatim. Secret detection for setting keys now treats any key segment ending in a secret word (`token`, `secret`, `password`, `passwd`, `pwd`, `credential(s)`) as secret instead of relying on a fixed list of camelCase prefixes, so it shows `<redacted>` like every other token setting. Token-budget settings such as `compaction.reserveTokens` stay visible.
