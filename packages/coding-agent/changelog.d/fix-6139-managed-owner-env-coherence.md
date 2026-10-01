### Fixed

- **Issue #6139**: Fixed incomplete managed-owner environment scrubbing in Bash child processes that left launch markers without corresponding owner metadata, causing downstream admission failures in nested GJC sessions. Now ensures owner context is handled atomically: nested children reach downstream consumers with either no owner-terminal markers or a complete, valid context.
