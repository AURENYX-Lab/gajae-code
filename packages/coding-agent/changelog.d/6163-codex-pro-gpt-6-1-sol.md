### Changed

- Built-in Codex profiles no longer use GPT-6 Sol or GPT-5.6 Terra. Every role that used `openai-codex/gpt-6-sol` or `openai-codex/gpt-5.6-terra` now uses `openai-codex/gpt-6.1-sol` at the same reasoning effort, so `codex-medium` and `codex-pro` are GPT-6.1 Sol in every role. Affected profiles: `codex-medium`, `codex-pro`, `astra-lite`, `astra-default`, `astra-heavy`, `opus-codex`, `codex-opencodego`, and `fable-opus-codex`. Moving Terra roles onto Sol is an intentional tier change; the catalog price of GPT-6.1 Sol is equal to or below Terra's. The `gpt-6-sol` and `gpt-5.6-terra` catalog entries are unchanged for explicit selection (#6163).
- `codex-eco` is now `codex-medium` with Sol lowered to `openai-codex/gpt-6-luna` at the same effort, so it uses GPT-6 Luna in every role. Its default, critic, and architect move from GPT-5.6 Terra to GPT-6 Luna (#6163).
- Roles that moved off GPT-5.6 Terra now compact earlier. GJC forces the Codex GPT-5.6 family to a 372K context window, while GPT-6.1 Sol and GPT-6 Luna use 272K, the window the Codex backend reports for both families (#6163).
- Installs that load a signed preset registry revision defining these profiles keep that registry binding (built-in, then registry, then user `models.yml`) until a registry revision carries this change (#6163).

### Removed

- Removed the `codex-sol61` built-in profile added in 0.18.2. A saved or requested `codex-sol61` now resolves to `codex-pro`, which differs in two roles: critic is `openai-codex/gpt-6.1-sol:max` instead of `:xhigh`, and architect is `openai-codex/gpt-6.1-sol:xhigh` instead of `openai-codex/gpt-6-astra:xhigh`. Define a custom `codex-sol61` profile in `models.yml` to keep the previous mapping; a user-defined profile takes precedence over the alias (#6163).
