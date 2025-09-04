# Redis Integration Documentation

This document provides an overview of how Redis is integrated and utilized within this application. Redis is an in-memory data structure store, often used as a database, cache, message broker, and for other purposes requiring high-performance data access.

## Role of Redis in the Application

In this project, Redis is likely used for various purposes, which can include:

*   **Caching:** Storing frequently accessed data to reduce database load and improve response times.
*   **Session Management:** Storing user session information for distributed applications.
*   **Rate Limiting:** Backing rate-limiting logic (potentially in conjunction with middleware).
*   **Distributed Locks:** Ensuring that certain operations are performed by only one process at a time in a distributed environment.
*   **Real-time Features:** Potentially for pub/sub messaging for real-time updates or notifications. For instance, Redis Pub/Sub is utilized by the `src/bus` module to enable a distributed event bus when Redis is configured and available.
*   **Queue Management:** As a backend for job queues if not using a dedicated queue service.

## Core Components

The Redis integration is primarily managed through files located in the `src/redis/` directory.

### 1. Connection Management (`src/redis/lib/`)

*   **`create-redis.ts`**: This module is responsible for creating and configuring the primary Redis client instance. It likely reads connection details (host, port, password, etc.) from environment variables and establishes the connection to the Redis server.
*   **`use-redis.ts`**: This utility function or hook provides a way to access the initialized Redis client instance throughout the application. It ensures that other parts of the codebase can easily get a reference to the client to perform Redis operations.

### 2. Main Export (`src/redis/index.ts`)

*   **`index.ts`**: This file typically serves as the main entry point for Redis functionalities. It might re-export the Redis client instance obtained from `use-redis.ts` or other key utilities, providing a clean and centralized way for other modules to import what they need.

### 3. Utilities (`src/redis/utils/`)

This subdirectory contains helper functions and specialized utilities that leverage Redis:

*   **`distributed-lock.ts`**: Implements a distributed locking mechanism. This is crucial in distributed systems to prevent race conditions or ensure that a critical section of code is executed by only one instance or process at a time. It likely uses Redis primitives like `SETNX` or Redlock-like algorithms.
*   **`redis-config-available.ts`**: A utility function to check if the necessary Redis configuration (e.g., connection URL or host/port) is present and valid in the environment. This can be used at application startup to gracefully handle missing Redis configuration or to conditionally enable Redis-dependent features.

## Configuration

Redis connection details are typically configured through environment variables. Common variables might include:

*   `REDIS_URL`: A full connection string (e.g., `redis://:password@hostname:port/db_number`).
*   Or, separate variables like:
    *   `REDIS_HOST`
    *   `REDIS_PORT`
    *   `REDIS_PASSWORD`
    *   `REDIS_DB` (database index)

The `create-redis.ts` module would use these environment variables to establish the connection. Refer to the environment configuration files (e.g., `.env.example`) for the specific variables used in this project.

## Usage Examples

**Getting the Redis Client:**

```typescript
// In a service or utility file
import { redis } from '../redis'; // Assuming index.ts exports the client as 'redis'
// Or using the hook/function from use-redis.ts directly if preferred
// import { useRedis } from '../redis/lib/use-redis';
// const redis = useRedis();

async function getCachedData(key: string) {
  if (!redis) {
    console.warn('Redis client not available');
    return null;
  }
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

async function setCachedData(key: string, value: any, ttlSeconds: number) {
  if (!redis) {
    console.warn('Redis client not available');
    return;
  }
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}
```

**Using a Distributed Lock:**

```typescript
// In a critical section of code
import { acquireLock, releaseLock } from '../redis/utils/distributed-lock';

async function performCriticalOperation(resourceId: string) {
  const lockKey = `lock:resource:${resourceId}`;
  const lockValue = generateUniqueLockValue(); // A unique value for this attempt
  const ttlMilliseconds = 30000; // Lock TTL

  if (await acquireLock(lockKey, lockValue, ttlMilliseconds)) {
    try {
      // --- Critical section: Perform operations ---
      console.log(`Lock acquired for ${resourceId}`);
      // ... do work ...
    } finally {
      await releaseLock(lockKey, lockValue);
      console.log(`Lock released for ${resourceId}`);
    }
  } else {
    console.warn(`Could not acquire lock for ${resourceId}. Operation skipped or retried later.`);
    // Handle lock acquisition failure (e.g., retry, skip, or error)
  }
}
```

This documentation should provide a good starting point for understanding and working with the Redis integration in this project. For more specific details, refer to the source code of the individual modules. 