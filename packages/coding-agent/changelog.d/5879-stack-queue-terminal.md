### Fixed

- Keep queued SDK prompts cancellable by their own authenticated requester without borrowing another active run's abort authority, and retire that capability after completion.
- Suspend queued prompt deadlines until exact consumption or promotion, attribute joined progress and terminals to the immutable consuming run and cancellation domain, and retire joined attribution on session teardown.
- Wait for the queued submission's durable terminal before returning deterministic cancellation; preserve uncertainty when persistence or exact execution settlement cannot be proved.
