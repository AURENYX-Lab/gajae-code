### Fixed

- A process dying between the POSIX lock-removal detach and payload scrub no longer wedges every subsequent launch with `FileLockAcquireError` ("blocked by abandoned removal transition"): the dead owner's `.lock.removing` transition is reclaimed through the identity-bound guarded removal, and a refused reclamation keeps contending and still reports the abandoned transition at exhaustion (#6253).
