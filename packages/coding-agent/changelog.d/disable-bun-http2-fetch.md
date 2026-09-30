### Fixed

- Fixed sessions intermittently hanging after a tool call on long contexts (seen with OpenGateway `-ultrafast` models). The CLI no longer routes `fetch()` through Bun's HTTP/2 client, which could stall a pooled connection on large request bodies until the process restarted.
