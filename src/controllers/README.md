# API Controllers (`src/controllers`)

This directory houses the controllers for the application's API. Controllers are responsible for handling incoming HTTP requests, validating input, interacting with services to perform business logic, and preparing data for the response.

## Overview

Controllers in this application are built using Express.js `Router`. They follow a service-oriented architecture, where the bulk of the business logic resides in dedicated service classes. Controllers act as an orchestration layer, managing the flow of data between the HTTP layer and the service layer.

Each `.ts` file in this directory typically represents a set of related API endpoints, often corresponding to a specific resource (e.g., `users.ts`, `files.ts`) or a domain of functionality (e.g., `auth.ts`, `server.ts`).

## Common Patterns and Structure

Across the controllers, several common patterns and architectural choices are evident:

*   **Express Routers**: Each controller file defines an `express.Router()` to group its routes.
*   **Service Layer**: Controllers delegate business logic to service classes (e.g., `UsersService`, `AuthenticationService`, `FilesService`). Services are typically instantiated within route handlers, often receiving request-specific context like `req.accountability` (for permissions and user context) and `req.schema`.
*   **Async Handling**: Route handlers performing asynchronous operations are wrapped with an `asyncHandler` utility (from `../helpers/utils/async-handler.js`), which centralizes error handling for promises.
*   **Middleware Pipeline**: A common set of middleware is used:
    *   `respond`: A final middleware in the chain, responsible for formatting and sending the HTTP response based on data prepared in `res.locals.payload`.
    *   Contextual Middleware: Such as `useCollection('collection_name')` to set the current database collection context, or `collectionExists` to validate collection names in route parameters.
    *   Validation Middleware: For example, `validateBatch` for operations involving multiple items.
    *   Security Middleware: Such as `checkRateLimit` for specific sensitive endpoints (e.g., user registration).
*   **Request Data**: Controllers access:
    *   Path parameters via `req.params`.
    *   Query parameters via `req.sanitizedQuery` (indicating prior sanitization).
    *   Request body via `req.body`.
    *   User context and permissions via `req.accountability`.
*   **Response Data**: Data intended for the client is typically placed in `res.locals.payload`, often structured as `{ data: ..., meta: ... }` (where `meta` might contain pagination or aggregation details).
*   **Custom Error Handling**: Uses a dedicated error system from `../helpers/errors/index.js`, throwing specific error classes (e.g., `InvalidPayloadError`, `ForbiddenError`, `RouteNotFoundError`). The `isYPError` type guard is used for checking error types.
*   **Modularity in Authentication**: `auth.ts` demonstrates a flexible approach by dynamically loading and mounting routers for different authentication drivers (local, OAuth2, OpenID, LDAP, SAML) based on application configuration.
*   **Event-Driven Extensibility**: `not-found.ts` utilizes an application-wide `emitter` to allow hooks/plugins to intercept and potentially handle 404 scenarios before a standard `RouteNotFoundError` is thrown.

## Handling API Query Parameters

Many API endpoints, particularly those that list or search through data collections (e.g., `GET /items/:collection`, `GET /users`), support a standardized set of query parameters to control data retrieval. These parameters allow clients to request specific data sets, order results, select fields, paginate, and perform searches.

Key supported query parameters include:

*   **`filter`**: Applies complex filtering conditions to the data.
*   **`sort`**: Specifies the order of the returned items.
*   **`fields`**: Selects which fields to include in the response, supporting dot-notation for related data.
*   **`limit`**: Restricts the maximum number of items returned.
*   **`offset`** (or **`page`**): Used for paginating through results.
*   **`search`**: Performs a full-text like search across relevant fields.
*   **`meta`**: Requests metadata about the query, such as total item counts.
*   Others like **`groupBy`**, **`aggregate`**, and **`deep`** may also be supported for more advanced querying.

**Processing Flow**:

1.  Incoming query parameters (`req.query`) are processed and validated by the `sanitizeQuery` middleware early in the request lifecycle.
2.  This middleware makes a sanitized and structured query object available as `req.sanitizedQuery` to subsequent middleware and controller handlers.
3.  Controllers pass this `req.sanitizedQuery` object (or relevant parts of it, like the `filter` or `sort` objects) to the appropriate service methods when requesting data.
4.  The service layer then utilizes helper functions from `src/helpers/utils/` (such as `applyQuery`, `parseFilter`, `validateQuery`) to translate these sanitized parameters into executable database queries (e.g., using Knex.js).

For comprehensive documentation on the syntax, available operators, and detailed behavior of each query parameter, please refer to the **`src/helpers/utils/README.md`** file, particularly its "Query Pipeline & Data Retrieval" and "Handling Relational Data" sections.

## Key Controller Files

While each file defines specific endpoints, some notable examples include:

*   **Resource Controllers (e.g., `users.ts`, `files.ts`, `roles.ts`, `items.ts`)**: Typically implement CRUD (Create, Read, Update, Delete) operations for a specific data entity. They handle both single-item and batch operations.
*   **`organizations.ts`**: Manages organization-related endpoints:
    *   **Purpose**: Handles CRUD operations for organizations, including special handling for organization logos.
    *   **Key Features**:
        *   Supports both single and batch operations for organizations
        *   Integrates with `OrganizationsService` for business logic
        *   Handles file uploads for organization logos
        *   Provides proper error handling and response formatting
        *   Supports query parameters for filtering, sorting, and pagination
    *   **Endpoints**:
        *   `POST /`: Create single or multiple organizations
        *   `GET /`: List organizations with filtering and pagination
        *   `GET /:pk`: Get a specific organization
        *   `PATCH /`: Update multiple organizations
        *   `PATCH /:pk`: Update a specific organization
        *   `DELETE /`: Delete multiple organizations
        *   `DELETE /:pk`: Delete a specific organization
*   **`auth.ts`**: Manages all authentication-related concerns, including login via various providers, token refresh, logout, and password management (request reset, perform reset).
*   **`server.ts`**: Provides server-level information and utilities:
    *   API specifications (OpenAPI, GraphQL schema generation).
    *   General server information (`/info`).
    *   Health check endpoint (`/health`).
*   **`utils.ts`**: Exposes a set of utility API endpoints:
    *   Random string generation.
    *   Password hashing (generate/verify, using Argon2).
    *   Generic sorting for items within a collection.
    *   Reverting an item to a previous revision.
    *   Cache clearing.
    *   Dummy email generation.
    *   Sending user feedback via email.
*   **`items.ts` (Generic Resource Controller)**:
    *   **Purpose**: Provides a dynamic and generic set of CRUDL (Create, Read, Update, Delete, List/Search) API endpoints for *any* data collection (database table) defined in the application's schema.
    *   **Dynamic Nature**: This controller uses a `/:collection` path parameter in its routes. By simply adding a new table to the database and ensuring the application's schema service is aware of it, fully functional API endpoints for that new resource become available automatically through this controller.
    *   **Functionality**: It leverages a generic `ItemsService` which takes the collection name as a parameter. It supports:
        *   Creating single or multiple items (`POST /:collection`).
        *   Reading items by ID (`GET /:collection/:pk`), by a list of keys, or by complex queries including filters, sorting, pagination, and field selection (`GET /:collection` or `SEARCH /:collection`).
        *   Updating single items (`PATCH /:collection/:pk`), multiple items by keys, by a query, or batch updates (`PATCH /:collection`).
        *   Deleting single items (`DELETE /:collection/:pk`), multiple items by keys, or by a query (`DELETE /:collection`).
        *   Special handling for "singleton" collections (collections designed to hold a single record).
    *   **Use Case**: This controller is fundamental to the application's ability to rapidly expose new data entities via the API without needing to write new controller code for each one. It forms the backbone of a highly dynamic and data-driven API.
*   **`graphql.ts`**: Likely handles GraphQL queries if the application supports a GraphQL API alongside REST.
*   **`tus.ts`**: Manages resumable file uploads using the TUS protocol.
*   **`not-found.ts`**: A catch-all handler for undefined routes, integrating with an event system for potential custom handling before issuing a 404.

## How Controllers are Integrated

Controllers defined in this directory are imported and mounted within `src/app.ts` onto the main Express application instance. Each controller's router is associated with a specific base path (e.g., `app.use('/users', usersRouter);`, `app.use('/auth', authRouter);`). Some integrations, like the TUS controller (`tusRouter`), may be conditional based on environment variable settings (e.g., `TUS_ENABLED`).

## General Workflow for a Request

1.  An HTTP request arrives at the Express application.
2.  Core middleware in `src/app.ts` executes, including pressure handling, security headers (Helmet), request logging (`pino-http`), CORS, body parsing (JSON with size limits), cookie parsing, and rate limiting (global and IP-based).
3.  Further middleware like `extractToken` (for auth tokens), `authenticate` (to establish `req.accountability`), `checkIP` (IP validation), `sanitizeQuery` (to process URL query parameters like `filter`, `sort`, `fields`, etc., and make them available as `req.sanitizedQuery`), `cache` (response caching), `schema` (to attach `req.schema`), and `getPermissions` (to augment `req.accountability` with detailed permissions) are processed.
4.  The Express router directs the request to the appropriate controller and route handler based on the matched path.
5.  Controller-specific middleware (if any) executes (e.g., `useCollection`, `validateBatch`).
6.  The controller handler is invoked.
7.  The controller instantiates necessary service(s), passing context like `req.accountability` and `req.schema`.
8.  It calls service method(s) with data from `req.body`, `req.params`, or the processed `req.sanitizedQuery` (for data retrieval operations).
9.  The service executes business logic (often interacting with the database via helpers from `src/helpers/utils/` to apply filters, sorting, etc., other services, or emitting events via the application `emitter`).
10. The service returns data (or throws a custom `YPError`).
11. The controller places the returned data into `res.locals.payload`.
12. The `asyncHandler` utility ensures any unhandled promise rejections from async route handlers are passed to Express's centralized error handling.
13. The `respond` middleware takes `res.locals.payload` and sends the final HTTP response.
14. If an error occurs (either thrown by a service, controller, or middleware), it is caught by the `errorHandler` middleware (defined in `src/middleware/error-handler.js`), which standardizes the error response format.

This structure promotes separation of concerns, making the codebase more maintainable, testable, and scalable.

## Detailed Endpoint Reference

Below is a controller-by-controller catalogue of every REST endpoint that exists under `src/controllers`.  Unless otherwise noted, all endpoints:

* Return successful results in the wrapped format `{ data: <payload>, meta?: <meta> }`.
* Accept common query-string helpers (`filter`, `sort`, `fields`, `limit`, `offset`, `search`, `meta`, …).  These helpers are described earlier in this document.
* Require the caller to supply a valid JWT access-token (unless the project is configured for public access to that resource).

For brevity, **PK** means the primary-key value of the resource (usually a UUID), and **COLL** means a collection / table name.

---
### 1. Auth Controller (`auth.ts`)
Base path: `/auth`

| Method | Path | Purpose | Required Body | Success Response |
| ------ | ---- | ------- | ------------- | ---------------- |
| GET | `/auth` | List available auth providers | – | `{ data: ProviderInfo[], disableDefault: boolean }` |
| POST | `/auth/refresh` | Exchange a **refresh_token** for a new access/refresh pair (or session cookie) | JSON-mode: `{ refresh_token, mode?: 'json' }` <br>Session-mode: — (cookie **yp_session_token**) | `{ data: { expires, access_token?, refresh_token? } }` |
| POST | `/auth/logout` | Invalidate a refresh token / session | Same shape as *refresh* | 200 (no body) |
| POST | `/auth/password/request` | Send password-reset email | `{ email: string, reset_url?: string }` | 200 |
| POST | `/auth/password/reset` | Complete password reset | `{ token: string, password: string }` | 200 |
| POST | `/auth/login/:provider` | Provider-specific login (local, oauth2, oidc, ldap, saml, …) | Depends on provider | `{ access_token, refresh_token, expires }` (json mode) **or** HttpOnly cookie (session mode) |

---
### 2. Users Controller (`users.ts`)
Base path: `/users`

General CRUD behaves like other resources (create, read, update, delete).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/users` | Create one (`{…}`) or many (`[{…}]`) users |
| GET/SEARCH | `/users` | List/search users |
| GET | `/users/me` | Current user profile |
| GET | `/users/:pk` | Fetch specific user |
| PATCH | `/users/me` | Update current user |
| PATCH | `/users/me/track/page` | Persist last visited page `{ last_page: string }` |
| PATCH | `/users` | Batch update (see *validateBatch*) |
| PATCH | `/users/:pk` | Update specific user |
| DELETE | `/users` | Batch delete |
| DELETE | `/users/:pk` | Delete specific user |
| POST | `/users/invite` | Send invitation(s) – `{ email(s), role, invite_url?, params? }` |
| POST | `/users/invite/accept` | Accept invite – `{ token, password, email }` |
| POST | `/users/me/tfa/generate` | Generate TFA secret – `{ password }` |
| POST | `/users/me/tfa/enable` | Enable TFA – `{ secret, otp }` |
| POST | `/users/me/tfa/disable` | Disable TFA – `{ otp }` |
| POST | `/users/:pk/tfa/disable` | Admin-disable another user's TFA – `{ otp }` |
| POST | `/users/register` | Public self-registration – `{ email, password, user_id, verification_url?, first_name?, last_name? }` |
| GET | `/users/register/verify-email` | Verify registration – query `token` |
| POST | `/users/register/verify-email/resend` | Resend verification – `{ email, verification_url? }` |

Return shape: user object(s).

---
### 3. Files Controller (`files.ts`)
Base path: `/files`

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST | `/files` |  • `multipart/form-data` upload *(one or many)* **or** JSON create <br>• When multipart the file stream plus companion form fields are accepted. |
| POST | `/files/import` | `{ url: string, data?: Partial<File> }` – import file from remote URL |
| GET/SEARCH | `/files` | List/search files |
| GET | `/files/:pk` | Single file metadata |
| PATCH | `/files` | Batch update |
| PATCH | `/files/:pk` | Update metadata **or** re-upload (multipart) |
| DELETE | `/files` | Batch delete |
| DELETE | `/files/:pk` | Delete single |

All endpoints return file record(s) in `{ data }`.

---
### 4. Assets Controller (`assets.ts`)
Base path: `/assets`

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET/HEAD | `/assets/:pk/:filename?` | Stream (or range-request) the binary asset. Supports query params for on-the-fly image transforms (`key`, `w`, `h`, `fit`, `format`, `quality`, `transforms`, …). Response is the file stream with appropriate headers (content-type, cache-control). |

---
### 5. Activity Controller (`activity.ts`)
Base path: `/activity`

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET/SEARCH | `/activity` | List activity entries |
| GET | `/activity/:pk` | Single entry |
| POST | `/activity/comment` | Create comment & attach to item `{ comment, collection, item }` |
| PATCH | `/activity/comment/:pk` | Update comment `{ comment }` |
| DELETE | `/activity/comment/:pk` | Delete comment |

---
### 6. Folders Controller (`folders.ts`)
Base path: `/folders` – standard CRUD:

`POST /`, `GET/SEARCH /`, `GET /:pk`, `PATCH /`, `PATCH /:pk`, `DELETE /`, `DELETE /:pk`

Bodies/returns mirror the pattern explained in Files.

---
### 7. Permissions Controller (`permissions.ts`)
Base path: `/permissions`

Same CRUD surface as *Folders*, plus:

* `GET /permissions/me/:collection/:pk?` – Return the effective permission set for the current user on the given collection (and optional item key).

---
### 8. Revisions Controller (`revisions.ts`)
Base path: `/revisions`

Read-only:

* `GET /revisions` (or `SEARCH /revisions`)
* `GET /revisions/:pk`

Returns revision record(s).

---
### 9. Roles Controller (`roles.ts`)
Base path: `/roles` – full CRUD (same signature as *Permissions*).

---
### 10. Organizations Controller (`organizations.ts`)
Base path: `/organizations` – full CRUD identical to *Folders*. `multipart/form-data` supported on `POST /` and `PATCH /:pk` for logo uploads.

---
### 11. Notifications Controller (`notifications.ts`)
Base path: `/notifications` – full CRUD identical to *Folders*.

---
### 12. Items Controller (`items.ts`)
Base path: `/items`

Dynamic, collection-agnostic endpoints (replace **COLL** with a collection name):

| Method | Path |
| ------ | ---- |
| POST | `/items/\<COLL>` |
| GET/SEARCH | `/items/\<COLL>` |
| GET | `/items/\<COLL>/\<PK>` |
| PATCH | `/items/\<COLL>` (batch / singleton upsert) |
| PATCH | `/items/\<COLL>/\<PK>` |
| DELETE | `/items/\<COLL>` |
| DELETE | `/items/\<COLL>/\<PK>` |

When **COLL** is a *singleton* collection the controller enforces singleton semantics (eg. PATCH acts as upsert and `/:pk` routes are invalid).

---
### 13. Server Controller (`server.ts`)
Base path: `/server`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/server/specs/oas` | Download OpenAPI (OAS) JSON |
| GET | `/server/specs/graphql/:scope?` | Download GraphQL SDL (`scope` = `items` default or `system`) |
| GET | `/server/info` | General server & build info |
| GET | `/server/health` | Healthcheck (`application/health+json`) – 503 when unhealthy |

---
### 14. Utils Controller (`utils.ts`)
Base path: `/utils`

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/utils/random/string?length=N` | Return a random string of length *N* |
| POST | `/utils/hash/generate` | `{ string }` → Argon2 hash |
| POST | `/utils/hash/verify` | `{ string, hash }` → boolean |
| POST | `/utils/sort/:collection` | `{ item, to }` – reorder item within collection |
| POST | `/utils/revert/:revision` | Roll back an item to a previous revision |
| POST | `/utils/cache/clear?system` | Clear cache layers |
| POST | `/utils/generate/dummy/email` | `{ first_name, domain }` → email |

---
### 15. TUS Controller (`tus.ts`)
Base path: `/tus`  (enabled only when resumable uploads are configured)

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST | `/tus` | Initiate resumable upload session |
| PATCH | `/tus/:id` | Upload chunk |
| DELETE | `/tus/:id` | Terminate upload |
| HEAD / OPTIONS | `/tus/:id` | Status / pre-flight |

The controller internally delegates to a TUS server implementation; responses follow the TUS protocol.

---
### 16. GraphQL Controller (`graphql.ts`)
Base path: `/graphql`

* `/graphql` – Items scope
* `/graphql/system` – System scope

Both endpoints accept standard GraphQL `POST` (JSON) or `GET` (query params) requests with the shape `{ query, variables?, operationName? }` and respond with standard GraphQL JSON.

---

> **Note**
> The *not-found* controller (`not-found.ts`) is a catch-all that throws a `404` when no other controller matches the request. It does not expose its own documented endpoints. 