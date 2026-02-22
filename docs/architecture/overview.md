# Architecture Overview

- Microservices architecture with domain boundaries.
- Each service owns its own datastore.
- Cross-domain consistency is handled with sagas and compensations.
- Event contracts are documented in `docs/events/contracts.md`.
