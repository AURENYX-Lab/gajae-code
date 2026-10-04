### Fixed

- Slack and Discord chat daemons no longer post every lean final answer twice. The host sends each turn frame on a positioned leg and a raw leg and drops the raw copy only for connections that negotiate `positioned_notification_effects_v1`; the chat daemons' session connections never did, and a lean final carries no `messageRef` to collapse the two copies onto one publication. Chat daemon session connections now negotiate positioned-only notification effects, while plain SDK observers such as `gjc sdk session tail` keep both surfaces.
