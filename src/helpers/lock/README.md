# Lock Helper (`src/helpers/lock`)

This directory provides a helper utility, `useLock()`, for obtaining a key-value (KV) store instance specifically intended for distributed or local locking mechanisms within the application.

## Overview

The `useLock()` function abstracts the underlying storage for locks. It can provide a Redis-backed KV store if Redis is configured for the application, enabling distributed locks across multiple processes or instances. If Redis is not available, it falls back to a local in-memory KV store, suitable for single-process locking.

The actual lock acquisition and release logic (e.g., using set-if-not-exists operations) is not implemented by this helper itself but is expected to be performed by the consumer using the methods of the returned KV store instance.

## Key Components

*   **`lib/use-lock.ts`**:
    *   Exports the primary function `useLock()`. 
    *   **`useLock(): Kv`**:
        *   Returns a globally shared (singleton within the context of this helper) KV store instance.
        *   **Conditional Storage Backend**:
            *   If Redis is configured (checked via `redisConfigAvailable()` from the application's Redis module):
                *   It initializes and returns a Redis-backed KV store (`createKv({ type: 'redis', ... })`).
                *   This KV store is namespaced (e.g., `'yourpartner:lock'`) to avoid key collisions in Redis.
            *   If Redis is not configured:
                *   It initializes and returns a local, in-memory KV store (`createKv({ type: 'local' })`).
        *   Depends on `createKv` and `Kv` type from `@/helpers/memory` (or a similar path) and Redis utilities (`redisConfigAvailable`, `useRedis`) from the application's Redis integration.

*   **`index.ts`**:
    *   Re-exports all exports from `lib/use-lock.ts`, making `useLock()` directly available via `@/helpers/lock` (or the relevant import path).

## How It Works

1.  When `useLock()` is called for the first time, it checks if a Redis configuration is available.
2.  Based on Redis availability, it creates either a Redis-backed or a local in-memory KV store instance. This instance is then cached.
3.  Subsequent calls to `useLock()` return the cached KV store instance.
4.  The consuming code can then use this KV store instance to implement locking logic (e.g., attempting to set a key with an "only if not exists" flag and a TTL for lock acquisition, and deleting the key for release).

## Usage Example

```typescript
import { useLock } from '@/helpers/lock'; // Adjust path as needed
import { setTimeout } from 'node:timers/promises';

const lockKvStore = useLock();

async function performCriticalOperation(resourceId: string) {
    const lockKey = `resource:${resourceId}:lock`;
    const lockTimeoutMs = 5000; // Lock valid for 5 seconds

    try {
        // Attempt to acquire the lock
        // Assuming the Kv store has a `set` method with NX (Not Exists) and PX (milliseconds TTL) options
        const acquired = await lockKvStore.set(lockKey, 'locked', { NX: true, PX: lockTimeoutMs });

        if (acquired) {
            console.log(`Lock acquired for ${resourceId}`);
            // --- Critical section --- 
            await setTimeout(1000); // Simulate work
            console.log(`Work done for ${resourceId}`);
            // --- End critical section ---
        } else {
            console.log(`Could not acquire lock for ${resourceId}, already locked.`);
            // Handle inability to acquire lock (e.g., retry, or skip)
            return false;
        }
    } catch (error) {
        console.error(`Error during locking operation for ${resourceId}:`, error);
        return false;
    } finally {
        // Release the lock by deleting the key, only if it was acquired by this instance.
        // More robust implementations might check the lock's value before deleting.
        // For simplicity, we assume if we got here after acquiring, we should try to release.
        // However, the KV store itself doesn't track who acquired it.
        // A common pattern is to store a unique ID in the lock value and check it before deleting.
        if (await lockKvStore.get(lockKey) === 'locked') { // Simplified check
             await lockKvStore.del(lockKey);
             console.log(`Lock released for ${resourceId}`);
        }
    }
    return true;
}

async function main() {
    await performCriticalOperation('my-resource-123');
    // Simulating another attempt, which might fail if the first one is still holding the lock (if local)
    // or if another process holds it (if distributed with Redis)
    await performCriticalOperation('my-resource-123'); 
}

main();
```

**Note**: The exact methods available on the `Kv` store instance (like `set` with NX/PX options, `del`, `get`) depend on the implementation of the `createKv` function from `@/helpers/memory`. The example above assumes typical Redis-like semantics for distributed locking operations.

## Dependencies

*   `@/helpers/memory`: For the `createKv` function and `Kv` type, providing the underlying key-value store abstraction.
*   Application's Redis module: For `redisConfigAvailable()` and `useRedis()` to enable Redis-backed distributed locks.

This helper centralizes the decision of using a distributed (Redis) or local lock store, simplifying lock management for consumers. 