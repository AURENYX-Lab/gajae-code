### Fixed

- SSH hosts loaded from `ssh.json` no longer accept a malformed `port`. A string port must be plain digits and every port must be an integer from 1 to 65535, so `"22oops"`, `"+22"`, `2222.5`, `0` and `70000` are now dropped with an `Invalid port` warning (the host falls back to the default port) instead of being used as 22, 22, 2222.5, 0 and 70000.
