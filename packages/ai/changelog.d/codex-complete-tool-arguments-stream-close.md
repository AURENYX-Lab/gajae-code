### Fixed

- Salvage Codex function calls when complete JSON arguments arrive but the stream closes before `response.output_item.done`, including empty-object no-argument calls and idle SSE stalls.
