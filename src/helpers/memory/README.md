# In-Memory Utilities (`src/helpers/memory`)

This directory provides a collection of in-memory data management utilities and supporting helpers. These modules are designed to offer efficient, memory-based solutions for common application needs like caching, messaging, rate limiting, and simple key-value storage.

## Overview

The `src/helpers/memory` module is a suite of distinct submodules, each catering to a specific in-memory functionality. These are generally self-contained but may use shared utilities from the `src/helpers/memory/utils/` directory.

The main `index.ts` in this directory re-exports the primary functionalities from the `bus`, `cache`, `kv`, and `limiter` submodules.

## Submodules

### 1. Event Bus (`bus/`)
*   **Purpose**: Implements a factory for creating event bus instances, supporting both in-memory (local) and Redis-backed (distributed) buses.
*   **Functionality**: The core export of this submodule (e.g., `createBus`) is a factory function. This factory is primarily consumed by the application-wide `useBus()` function (located in `src/bus/`). The `useBus()` service determines whether to instantiate a local bus or a Redis-backed bus based on Redis availability, using the `createBus` factory for the actual instantiation. This allows different parts of the application to communicate asynchronously via a publish/subscribe mechanism, with the underlying transport (local memory or Redis) being abstracted by `useBus()`.
*   **Structure**: Contains the `createBus` factory and related utilities for constructing event bus instances.

### 2. Caching (`cache/`)
*   **Purpose**: Provides an in-memory caching mechanism.
*   **Functionality**: Useful for storing frequently accessed data in memory to reduce latency and load on underlying data sources (e.g., databases, external APIs). May include features like TTL (time-to-live) for cache entries.
*   **Structure**: Contains `lib/` for the caching logic, `types/` for definitions, and an `index.ts`.

### 3. Key-Value Store (`kv/`)
*   **Purpose**: Offers a simple in-memory key-value storage solution.
*   **Functionality**: Allows storing and retrieving data using unique keys. Suitable for temporary storage, session data, or other scenarios where a lightweight, fast key-value store is beneficial.
*   **Structure**: Contains `lib/` for implementation, `types/` for definitions, and an `index.ts`.

### 4. Rate Limiter (`limiter/`)
*   **Purpose**: Implements an in-memory rate limiting mechanism.
*   **Functionality**: Helps control the rate at which certain operations can be performed, protecting resources from abuse or overload. May support various limiting strategies (e.g., token bucket, fixed window).
*   **Structure**: Contains `lib/` for the core limiting logic, `types/` for definitions, potentially its own `utils/` for specific helpers, and an `index.ts`.

### 5. Shared Utilities (`utils/`)
*   **Purpose**: Provides common utility functions used by the other in-memory modules.
*   **Functionality**: This directory includes helpers for:
    *   Serialization and deserialization of data.
    *   Data compression and decompression.
    *   Conversions between strings, Buffers, and Uint8Arrays.
    *   Namespacing keys or identifiers.
*   **Note**: These utilities are generally not directly exported by the main `src/helpers/memory/index.ts` but are consumed internally by the other submodules.

## Usage

To use one of the in-memory utilities, import it from the main `@/helpers/memory` path (adjust based on project aliases) or directly from its submodule if preferred and if the submodule's `index.ts` exports the desired functionality.

```typescript
// Example: Using the cache (hypothetical API)
import { CacheManager } from '@/helpers/memory'; // Assuming CacheManager is exported

const cache = new CacheManager({ defaultTTL: 60000 }); // 1 minute TTL
cache.set('myKey', { data: 'some value' });
const value = cache.get('myKey');

// Example: Using the event bus (hypothetical API)
import { eventBus } from '@/helpers/memory'; // Assuming a singleton eventBus is exported

eventBus.subscribe('user:created', (userData) => {
  console.log('New user created:', userData);
});

eventBus.publish('user:created', { id: 1, name: 'John Doe' });
```

Refer to the specific `index.ts` and type definitions within each submodule (`bus/`, `cache/`, `kv/`, `limiter/`) for detailed API usage and available options. 