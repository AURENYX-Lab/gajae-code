### Fixed

- **Retry transport errors on custom endpoints**: Pre-response transport failures (ECONNRESET, socket closed, connection refused) on custom anthropic-messages endpoints are now properly retried with bounded exponential backoff, instead of being clamped to a single retry attempt. The one-attempt ceiling on large uploads now applies only to genuine first-event timeouts, not to connection errors that occur before any response bytes are received. This allows the session-level retry machinery to handle transient connection issues correctly.

- **Expanded connection error detection**: Updated transient error patterns to recognize additional connection error variations (connection refused, connection reset, connection closed) alongside the existing connection error patterns, and relaxed socket close message detection to match variations like "socket closed unexpectedly" without requiring "connection" in the message.
