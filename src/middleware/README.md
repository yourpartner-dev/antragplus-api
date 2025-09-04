# Middleware Documentation

This document provides an overview of the middleware used in this Express.js application. Middleware functions are a crucial part of the request-response cycle, allowing for modular and reusable request processing logic.

## What is Middleware?

In the context of Express.js, middleware functions are functions that have access to the request object (`req`), the response object (`res`), and the next middleware function in the application's request-response cycle (commonly denoted by a variable named `next`).

Middleware functions can perform the following tasks:

*   Execute any code.
*   Make changes to the request and the response objects.
*   End the request-response cycle.
*   Call the next middleware function in the stack.

If the current middleware function does not end the request-response cycle, it must call `next()` to pass control to the next middleware function. Otherwise, the request will be left hanging.

Middleware can be applied at different levels:

*   **Application-level middleware:** Bound to the app object using `app.use()` or `app.METHOD()`.
*   **Router-level middleware:** Bound to an instance of `express.Router()`.
*   **Error-handling middleware:** Has a special signature `(err, req, res, next)` and is called when an error occurs.
*   **Built-in middleware:** Standard middleware functions provided by Express (e.g., `express.json()`, `express.static()`).
*   **Third-party middleware:** Middleware installed via npm (e.g., `cookie-parser`, `cors`).

## Available Middleware

The following is a list of custom middleware components found in the `src/middleware` directory, along with a brief description of their likely purpose based on their names. For detailed behavior, refer to the source code of each file.

*   **`authenticate.ts`**
    *   **Purpose:** Handles user authentication. It likely verifies credentials (e.g., a token from the `extract-token.ts` middleware) and attaches user information to the request object if authentication is successful. Crucial for securing routes that require logged-in users.

*   **`cache.ts`**
    *   **Purpose:** Implements caching strategies for responses. This can help improve performance by serving cached content for certain requests, reducing database load and response times.

*   **`check-ip.ts`**
    *   **Purpose:** Checks the IP address of the incoming request against an allowlist or denylist. Used for security purposes to restrict access based on IP.

*   **`collection-exists.ts`**
    *   **Purpose:** Verifies if a specified collection (likely a database table or a defined data model) exists before proceeding with a request that targets it. Helps in validating dynamic route parameters or query parameters referring to collections.

*   **`cors.ts`**
    *   **Purpose:** Implements Cross-Origin Resource Sharing (CORS) headers. This is essential for allowing or restricting web applications from different domains to make requests to your API.

*   **`error-handler.ts`**
    *   **Purpose:** A centralized error-handling middleware. It catches errors that occur during the request processing (both synchronous and asynchronous passed via `next(err)`) and formats an appropriate error response to be sent to the client.

*   **`extract-token.ts`**
    *   **Purpose:** Extracts authentication tokens (e.g., JWT) from the request, typically from an `Authorization` header or cookies. The extracted token is then likely used by `authenticate.ts`.

*   **`get-permissions.ts`**
    *   **Purpose:** Fetches and attaches user permissions to the request object. This middleware likely runs after authentication and is used by subsequent route handlers or other middleware to perform authorization checks.

*   **`graphql.ts`**
    *   **Purpose:** Likely sets up and handles GraphQL requests, possibly integrating a GraphQL server (like Apollo Server or express-graphql) into the Express application.

*   **`rate-limiter-global.ts`**
    *   **Purpose:** Implements a global rate limiting strategy for all or a broad set of API endpoints. Helps protect the API from abuse and ensure fair usage.

*   **`rate-limiter-ip.ts`**
    *   **Purpose:** Implements rate limiting based on the client's IP address. This is a common strategy to prevent brute-force attacks or excessive requests from a single IP.

*   **`rate-limiter-registration.ts`**
    *   **Purpose:** Specifically applies rate limiting to registration-related endpoints. This helps prevent automated scripts from creating a large number of user accounts.

*   **`respond.ts`**
    *   **Purpose:** A utility middleware or a set of helper functions to standardize API responses. It might provide functions to send consistent JSON responses with appropriate status codes.

*   **`sanitize-query.ts`**
    *   **Purpose:** Cleans and sanitizes query parameters from the request URL. This is a security measure to prevent NoSQL injection, XSS, or other query-based attacks and to ensure data consistency.

*   **`schema.ts`**
    *   **Purpose:** Likely related to database schema access or management. It might attach schema information to the request or provide utilities to interact with the application's data schema.

*   **`use-collection.ts`**
    *   **Purpose:** A utility middleware that might simplify working with a specific collection by pre-fetching it or setting it up in the request context based on a route parameter.

*   **`validate-batch.ts`**
    *   **Purpose:** Validates requests for batch operations (e.g., creating, updating, or deleting multiple items in a single request). Ensures the batch payload conforms to expected structures and constraints.

## Usage

Middleware is typically registered in `src/app.ts` using `app.use()` for application-wide middleware or directly in router definitions for more specific use cases.

**Example (Application-level):**
```typescript
// In app.ts
import express from 'express';
import myMiddleware from './middleware/my-middleware.js';

const app = express();
app.use(myMiddleware);
```

**Example (Router-level):**
```typescript
// In a router file
import express from 'express';
import specificMiddleware from '../middleware/specific-middleware.js';

const router = express.Router();
router.get('/protected-route', specificMiddleware, (req, res) => {
  // handle request
});
```

Error-handling middleware is typically defined last, after all other `app.use()` and routes calls.

Refer to the Express.js documentation for more comprehensive information on using middleware. 