# Event Bus (`src/bus`)

This directory provides a centralized mechanism for accessing a potentially distributed event bus within the YP application.

## Overview

The core of this module is the `useBus()` function, which acts as a singleton accessor to an event bus instance. This bus facilitates decoupled communication between different parts of the application through a publish-subscribe pattern.

A key feature is its ability to adapt its backend based on Redis availability:

*   **Redis-backed Bus**: If Redis is configured and available (checked via `redisConfigAvailable()` from `src/redis/`), `useBus()` will instantiate a distributed event bus using Redis Pub/Sub. This allows for event communication across multiple processes or servers. The Redis bus is created using the `createBus` factory from `src/helpers/memory/bus/` and is namespaced to `'yourpartner:bus'`.
*   **Local Bus**: If Redis is not available, `useBus()` defaults to a local, in-memory event bus (also instantiated via `createBus` from `src/helpers/memory/bus/`). This bus operates only within the current process.

This conditional logic ensures that the application can leverage a distributed bus when possible, while still functioning correctly with an in-memory bus in simpler deployment scenarios or during development if Redis is not set up.

## Key Files

*   **`src/bus/index.ts`**: Re-exports the `useBus` function from `lib/use-bus.ts`.
*   **`src/bus/lib/use-bus.ts`**: Contains the `useBus()` function, which includes the logic for caching the bus instance and deciding whether to create a Redis-backed or local bus.

## Usage

To use the event bus, other modules should import and call `useBus()`:

```typescript
import { useBus } from 'path/to/src/bus'; // Adjust path as needed

const bus = useBus();

// To publish an event
bus.emit('eventName', { data: 'some_payload' });

// To subscribe to an event
bus.on('eventName', (payload) => {
  console.log('Event received:', payload);
});

// To unsubscribe
// bus.off('eventName', handlerFunction); // If a specific handler needs to be removed
```

## Dependencies

*   **`src/helpers/memory/bus/`**: Provides the `createBus` factory function used to instantiate both local and Redis-backed bus instances.
*   **`src/redis/`**: Provides `redisConfigAvailable()` to check Redis readiness and `useRedis()` to obtain a Redis client instance when a distributed bus is being created.

This setup allows for a flexible eventing system that adapts to the available infrastructure. 