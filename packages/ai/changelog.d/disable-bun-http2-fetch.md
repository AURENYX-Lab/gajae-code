### Removed

- Removed `installH2Fetch`. Bun's HTTP/2 client can wedge a pooled connection while uploading a large request body (~300 KB, a typical long agent context): every later request on that connection waits indefinitely for response headers. All `fetch()` traffic now uses HTTP/1.1.

### Fixed

- OpenAI-compatible completions requests now log OpenAI SDK connection timeouts and retries to the gjc log. Previously a request stalled before response headers retried silently for up to several minutes.
