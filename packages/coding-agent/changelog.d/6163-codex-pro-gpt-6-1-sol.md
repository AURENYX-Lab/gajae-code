### Changed

- Built-in model profiles that used `openai-codex/gpt-6-sol` now use `openai-codex/gpt-6.1-sol` at the same reasoning effort, with no tier changes: `codex-medium`, `codex-pro`, `astra-lite`, `astra-default`, `astra-heavy`, `opus-codex`, `codex-opencodego`, and `fable-opus-codex`. The `gpt-6-sol` catalog entry is unchanged for explicit selection. Installs that load a signed preset registry revision defining these profiles keep that registry binding (built-in, then registry, then user `models.yml`) until a registry revision carries this change (#6163).

### Removed

- Removed the `codex-sol61` built-in profile added in 0.18.2; GPT-6.1 Sol is now the Sol model in `codex-pro` and the other built-in profiles. Select `codex-pro`, or define a custom profile in `models.yml` for the previous `codex-sol61` mapping (#6163).
