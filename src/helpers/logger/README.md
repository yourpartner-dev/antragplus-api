# Logging Helper (`src/helpers/logger`)

This directory provides a comprehensive and configurable logging solution for the application, built upon the `pino` and `pino-http` libraries. It offers both general-purpose logging and specialized middleware for Express.js request logging, with a strong focus on performance and security through redaction.

## Overview

The logger is designed to be highly configurable via environment variables, allowing for different log levels, output styles (raw JSON or human-readable pretty-print), and redaction rules. It ensures that sensitive information (like authorization tokens, cookies, and specific query parameters) is removed from logs.

## Key Components

### 1. `index.ts`
This is the main file and exports the core logging functionalities:

*   **`createLogger(): Logger`**: 
    *   Creates and returns a standard `pino` logger instance.
    *   **Configuration (via Environment Variables)**:
        *   `LOG_LEVEL`: Sets the minimum log level (e.g., 'info', 'debug', 'warn', 'error'). Defaults to 'info'.
        *   `LOG_STYLE`: If set to `'raw'`, outputs JSON logs. Otherwise, uses `pino-pretty` for human-readable output (ignores hostname, pid; sync printing).
        *   `LOGGER_LEVELS`: Allows mapping log levels to custom severity names (e.g., `LOGGER_LEVELS="info:INFORMATION,warn:WARNING"`).
        *   Other `LOGGER_*` variables can be used to pass additional options directly to the Pino logger (see Pino documentation).
    *   **Redaction**: Automatically redacts `req.headers.authorization` and `req.headers.cookie`.

*   **`useLogger(): Logger`**: 
    *   A singleton accessor for the logger instance created by `createLogger()`. It caches and returns the same logger instance on subsequent calls.
    *   This is the recommended way to get a logger instance for general application logging.

*   **`createExpressLogger(): RequestHandler`**: 
    *   Creates and returns a `pino-http` middleware for logging Express.js requests and responses.
    *   **Configuration (via Environment Variables)**:
        *   Inherits `LOG_LEVEL` and `LOG_STYLE` behavior from `createLogger`.
        *   If `LOG_STYLE` is not `'raw'`, uses `pino-http-print` for pretty-printing HTTP logs (shows all fields, translates time, uses relative URLs).
        *   `LOG_HTTP_IGNORE_PATHS`: A comma-separated string of URL paths to exclude from logging (e.g., `"/healthz,/metrics"`).
        *   Other `LOGGER_HTTP_*` variables can pass additional options to `pino-http`.
    *   **Redaction**: 
        *   Includes redaction from `createLogger`.
        *   If `LOG_STYLE` is `'raw'`, it also redacts `res.headers` (specifically `set-cookie` values) and `req.query.access_token`.
        *   Uses a custom request serializer that leverages the `redactQuery` function to sanitize `access_token` from URLs.

### 2. `redact-query.ts`

*   **`redactQuery(originalPath: string): string`**: 
    *   A utility function specifically designed to remove sensitive query parameters from URLs before they are logged.
    *   Currently, it targets the `access_token` query parameter and replaces its value with a standard redaction placeholder (e.g., `"[REDACTED]"`).
    *   If parsing the URL fails, it returns the original path to prevent crashing the logging process.

## How It Works

1.  **Initialization**: Logger instances (either standard or Express middleware) are created using `createLogger()` or `createExpressLogger()`. These functions read environment variables to configure behavior, levels, style, and redaction rules.
2.  **General Logging**: For application-wide logging, `useLogger()` provides a shared logger instance. Developers can call methods like `logger.info('Message')`, `logger.error(err)`, etc.
3.  **HTTP Request Logging**: The `createExpressLogger()` middleware is added to an Express app. It automatically logs incoming requests and outgoing responses, including metadata like request ID, URL, method, status code, and response time.
4.  **Redaction**: Before any log entry is written, `pino`'s redaction rules are applied. For HTTP logs, the custom request serializer further invokes `redactQuery` to ensure URL query parameters are safe.

## Usage Examples

**General Application Logging:**

```typescript
import { useLogger } from '@/helpers/logger'; // Adjust path as needed

const logger = useLogger();

logger.info('Application started successfully.');
logger.warn({ userId: 123 }, 'A potentially risky operation was attempted.');

try {
  // ... some operation ...
} catch (error) {
  logger.error({ err: error }, 'An unexpected error occurred.');
}
```

**Express HTTP Request Logging:**

```typescript
import express from 'express';
import { createExpressLogger } from '@/helpers/logger'; // Adjust path as needed

const app = express();
const expressLogger = createExpressLogger();

app.use(expressLogger);

app.get('/', (req, res) => {
  // req.log is available here if needed for context within the request
  req.log.info('Processing GET / request');
  res.send('Hello World with logging!');
});

// Example route that might have an access_token
app.get('/api/data', (req, res) => {
  // If /api/data?access_token=secret is called, the token will be redacted in logs.
  res.json({ data: 'sensitive info' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const logger = useLogger(); // Can use the general logger for app-level events
  logger.info(`Server listening on port ${PORT}`);
});
```

## Configuration Summary (Environment Variables)

*   `LOG_LEVEL`: (e.g., `trace`, `debug`, `info`, `warn`, `error`, `fatal`)
*   `LOG_STYLE`: (`raw` or any other value for pretty-printing)
*   `LOGGER_LEVELS`: (e.g., `info:INFORMATION,warn:WARNING`)
*   `LOG_HTTP_IGNORE_PATHS`: (e.g., `"/healthz,/metrics"`)
*   `LOGGER_*`: General Pino options.
*   `LOGGER_HTTP_*`: Pino-HTTP options.

This logger setup provides a balance of performance, structured logging, and security, making it suitable for development and production environments. 