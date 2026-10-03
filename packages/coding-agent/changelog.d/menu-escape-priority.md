### Fixed

- Keep Escape local to focused menus and nested selectors during compaction, handoff, retry backoff, and MCP/Smithery browser authorization, instead of interrupting the background operation. Preserve Ctrl+C global cancellation and hook workflow interrupt behavior.
