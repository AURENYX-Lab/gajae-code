### Changed

- Built-in model profiles that used `openai-codex/gpt-6-sol` now use `openai-codex/gpt-6.1-sol` at the same reasoning effort, with no tier changes: `codex-medium`, `codex-pro`, `astra-lite`, `astra-default`, `astra-heavy`, `opus-codex`, `codex-opencodego`, and `fable-opus-codex`. The `gpt-6-sol` catalog entry is unchanged for explicit selection. Installs that load a signed preset registry revision defining these profiles keep that registry binding (built-in, then registry, then user `models.yml`) until a registry revision carries this change (#6163).
- `gpt-6.1-sol` has a 272K (272,000-token) context window; the catalog lists the same 272K limit for `gpt-6-sol`. Sessions above 272K on `codex-pro`, `codex-medium`, and the other migrated profiles compact at that limit after this change (#6163).

### Removed

- Removed the `codex-sol61` built-in profile added in 0.18.2; persisted `codex-sol61` selections now resolve to `codex-pro` via a legacy alias, like `codex-standard` → `codex-medium`. Users who want the exact old mapping can define a custom `codex-sol61` profile in `models.yml`, which takes precedence over the alias (#6163).
