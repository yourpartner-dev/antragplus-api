# Custom Error Handling (`src/helpers/errors`)

This directory implements a structured and extensible system for custom error handling within the application. It allows for the creation of specific error types, each with a unique error code, an appropriate HTTP status code, and optional custom extension properties for additional context.

## Overview

The system is built around a base `YPError` type and a factory function `createError` that generates custom error classes. These errors are designed to be easily identifiable and provide rich information for debugging, logging, and client responses.

Key features include:

*   A predefined set of `ErrorCode` enums.
*   A factory (`createError`) for generating new error classes.
*   Individual error class definitions (e.g., `InvalidPayloadError`, `RouteNotFoundError`).
*   A type guard (`isYPError`) to safely check and type narrowed custom errors.
*   Support for custom `extensions` on a per-error-type basis for additional data.
*   Dynamic message construction based on error extensions.

## Key Components

### 1. `create-error.ts`

*   **`YPError<Extensions>` interface**: Extends the built-in `Error` and adds:
    *   `extensions: Extensions`: Custom data specific to the error type.
    *   `code: string`: A unique, uppercase string code (from `ErrorCode`).
    *   `status: number`: An HTTP status code appropriate for the error.
*   **`createError<Extensions>(code: string, message: string | ((extensions: Extensions) => string), status = 500): YPErrorConstructor<Extensions>`**: 
    *   A factory function that returns a constructor for a new error class.
    *   The generated class extends `Error`, implements `YPError`, and sets its `name` property to `'YPError'`.
    *   `message` can be a static string or a function that receives `extensions` to build a dynamic message.

### 2. `codes.ts`

*   **`ErrorCode` enum**: Defines a comprehensive list of unique error codes used throughout the application (e.g., `ErrorCode.InvalidPayload`, `ErrorCode.TokenExpired`).

### 3. `errors/` subdirectory

*   Contains individual files for each specific custom error (e.g., `invalid-payload.ts`, `route-not-found.ts`).
*   Each file typically:
    1.  Defines an interface for its specific `Extensions` (if any).
    2.  Provides a `messageConstructor` function that uses these extensions to create a descriptive error message.
    3.  Calls `createError()` with an `ErrorCode`, the `messageConstructor`, and an HTTP `status` code to define and export the error class.
*   `errors/index.ts`: Re-exports all individual error classes defined in this subdirectory.

### 4. `types.ts`

*   **`ExtensionsMap` type**: A mapped type that links each `ErrorCode` to the TypeScript interface of its corresponding `extensions`. This is vital for type safety and inference when using `isYPError`.

### 5. `is-yp-error.ts`

*   **`isYPError(value: unknown, code?: ErrorCode): value is YPError<...>`**: 
    *   A type guard function.
    *   Checks if an unknown `value` is a `YPError` (by checking its `name` property).
    *   Can optionally check if the error matches a specific `ErrorCode`.
    *   Provides type narrowing for the `extensions` property if a specific `code` is provided, leveraging `ExtensionsMap`.

### 6. `index.ts` (main entry point)

*   Re-exports the essential parts of the error system: `createError`, `ErrorCode`, `isYPError`, and all specific error classes from `errors/index.js`.

## How It Works

1.  **Definition**: Custom errors are defined in the `errors/` subdirectory. Each uses `createError` to generate a class, associating it with an `ErrorCode`, a message (or message constructor), an HTTP status, and an optional extensions interface.
2.  **Creation (Throwing)**: To throw a custom error, instantiate one of the defined error classes, providing any required extensions.
    ```typescript
    import { InvalidPayloadError } from '@/helpers/errors'; // Or from '@/helpers/errors/errors'
    throw new InvalidPayloadError({ reason: 'Missing required field: email' });
    ```
3.  **Catching and Checking**: When catching errors, `isYPError` can be used to safely determine if an error is a known custom error and to access its properties (`code`, `status`, `extensions`) in a type-safe manner.
    ```typescript
    import { isYPError, ErrorCode } from '@/helpers/errors';
    try {
      // ... code that might throw
    } catch (err) {
      if (isYPError(err, ErrorCode.InvalidPayload)) {
        // err is now typed as YPError<InvalidPayloadErrorExtensions>
        console.error(`Invalid Payload: ${err.message}, Reason: ${err.extensions.reason}, Status: ${err.status}`);
      } else if (isYPError(err)) {
        // Generic YPError
        console.error(`YP Error: ${err.message}, Code: ${err.code}, Status: ${err.status}`);
      } else {
        // Unknown error
        console.error('An unexpected error occurred:', err);
      }
    }
    ```

## Usage Example

```typescript
// Defining a new error (simplified example, typically in errors/some-error.ts)
// import { createError, ErrorCode } from '../index.js';
// interface MyCustomErrorExtensions { detail: string; itemId: number }
// export const MyCustomError = createError<MyCustomErrorExtensions>(
//   ErrorCode.Internal, // Or a new custom code added to ErrorCode
//   (ext) => `My custom error occurred for item ${ext.itemId}: ${ext.detail}`,
//   500
// );

// Throwing the error
// throw new MyCustomError({ detail: 'Something specific went wrong', itemId: 123 });

// Handling (as shown in the "Catching and Checking" section above)
```

This system provides a robust way to manage errors, ensuring that they are informative, carry relevant status codes for HTTP responses, and can include additional structured data for better error handling and diagnostics. 