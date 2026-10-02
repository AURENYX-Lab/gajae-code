### Fixed

- Salvage Codex function calls when complete JSON arguments arrive but the stream closes before `response.output_item.done`, including empty-object no-argument calls and idle SSE stalls.
- Fail closed on mismatched argument events, explicit non-transient errors, and unauthoritative whitespace-only deltas; close open reasoning blocks before salvage.
