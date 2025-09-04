# Pressure Handling and Monitoring (`src/helpers/pressure`)

This directory contains utilities for monitoring the operational pressure of a Node.js application and an Express middleware to handle high-load situations by gracefully rejecting requests.

## Overview

In high-traffic applications, it's crucial to prevent the server from becoming overwhelmed. This module provides a `PressureMonitor` class to track key performance metrics like event loop delay, event loop utilization, and memory usage. It also offers an Express middleware, `handlePressure`, which uses the `PressureMonitor` to return a 503-like error (Service Unavailable) when predefined pressure limits are exceeded, allowing the server to shed load and maintain stability.

## Key Components

### 1. `monitor.ts`

*   **`PressureMonitor` Class**:
    *   **Purpose**: Continuously monitors system pressure.
    *   **Metrics Tracked**:
        *   `memoryHeapUsed`: Heap memory used by the Node.js process.
        *   `memoryRss`: Resident Set Size (total memory allocated to the process).
        *   `eventLoopDelay`: Mean delay of the Node.js event loop.
        *   `eventLoopUtilization`: A measure of how busy the event loop is.
    *   **Constructor `constructor(options: PressureMonitorOptions = {})`**:
        *   `options` allows setting thresholds for the monitored metrics:
            *   `maxEventLoopDelay`: (number | false) - Max allowed event loop delay in milliseconds.
            *   `maxEventLoopUtilization`: (number | false) - Max allowed event loop utilization (a value between 0 and 1).
            *   `maxMemoryHeapUsed`: (number | false) - Max allowed heap memory in bytes.
            *   `maxMemoryRss`: (number | false) - Max allowed RSS memory in bytes.
            *   `sampleInterval`: (number, default: 250) - How often (in ms) to sample the metrics.
            *   `resolution`: (number, default: 10) - Resolution for event loop delay monitoring (in ms).
    *   **`overloaded` (getter)**: Returns `true` if any of the configured maximum thresholds are exceeded, `false` otherwise.
    *   Uses `node:perf_hooks` for event loop metrics and `node:process` for memory metrics.

### 2. `express.ts`

*   **`handlePressure(options: PressureMonitorOptions & { error?: Error; retryAfter?: string }): RequestHandler`**:
    *   **Purpose**: An Express middleware to reject requests when the system is under high pressure.
    *   **Functionality**:
        1.  Initializes a `PressureMonitor` instance with the given `options`.
        2.  For each incoming request, it checks `monitor.overloaded`.
        3.  If `true`:
            *   Optionally sets a `Retry-After` HTTP header if `options.retryAfter` (string) is provided.
            *   Calls `next()` with an error. The error can be a custom error passed via `options.error` or defaults to `new Error('Pressure limit exceeded')`.
        4.  If `false`, calls `next()` to allow the request to proceed normally.

### 3. `index.ts`

*   Re-exports all public APIs from `monitor.ts` and `express.ts` for easy consumption.

## How It Works

1.  The `PressureMonitor` periodically samples event loop performance and memory usage.
2.  The `handlePressure` middleware is added to an Express application's middleware stack (typically early in the stack).
3.  When a request arrives, the middleware consults the `PressureMonitor`.
4.  If the monitor indicates an `overloaded` state based on the configured thresholds, the middleware short-circuits the request by passing an error to Express's error handling, usually resulting in a 503 Service Unavailable response to the client.

## Usage Example

```typescript
import express from 'express';
import { handlePressure } from '@/helpers/pressure'; // Adjust path as needed

const app = express();

// Configure pressure handling
// Example: Reject requests if event loop delay > 70ms or heap used > 150MB
app.use(handlePressure({
    maxEventLoopDelay: 70, // 70ms
    maxMemoryHeapUsed: 150 * 1024 * 1024, // 150 MB
    retryAfter: '60' // Suggest client retry after 60 seconds
}));

// Your regular routes and other middleware
app.get('/', (req, res) => {
    res.send('Hello World!');
});

// ... (Error handling middleware might be needed to customize the 503 response)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
```

This setup helps protect the application from being overwhelmed by traffic spikes or resource-intensive operations, improving its overall resilience. 