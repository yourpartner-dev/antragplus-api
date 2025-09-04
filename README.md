# api-generator
Realtime API generator from SQL database

## Overview

This project provides a realtime API generator capable of interfacing with SQL databases. It offers features such as dynamic query building, WebSocket support for real-time updates and GraphQL subscriptions, a flexible storage abstraction layer, robust authentication, and a command-line interface for application management.

## Key Root Files

*   **`package.json`**: Defines project metadata, dependencies, and scripts for building, testing, and running the application.
*   **`pnpm-lock.yaml`**: Lockfile for `pnpm` ensuring reproducible dependency installations.
*   **`Dockerfile`**: Contains instructions to build a Docker image for the application, enabling containerized deployments.
*   **`docker-compose.yml` & `docker-compose.yml.development`**: Docker Compose files for orchestrating multi-container setups, likely for production/staging and local development environments respectively.
*   **`.example.env.local` & `.example.env.QA`**: Example environment variable files. While these can be copied manually (e.g., to `.env.local`), the recommended way to generate your initial `.env` file is through the interactive `init` command provided by the CLI (see `src/cli/README.md`).
*   **`tsconfig.json` & `tsconfig.prod.json`**: TypeScript configuration files for development and production builds, respectively.
*   **`vitest.config.ts`**: Configuration file for Vitest, the testing framework used in this project.
*   **`.gitignore`**: Specifies intentionally untracked files that Git should ignore.

## Source Code Modules (`src/`)

The primary application code is located in the `src/` directory. Below is an overview of its main modules, with links to their detailed README files for more information on their specific functionalities and how they work:

*   **`src/auth/`**: Handles authentication mechanisms, including different providers and strategies. ([Details](./src/auth/README.md))
*   **`src/bus/`**: Implements the application-wide event bus, facilitating communication between different modules, potentially backed by Redis for distributed environments. ([Details](./src/bus/README.md))
*   **`src/cli/`**: Contains the command-line interface logic, providing tools for project initialization (including `.env` file generation), database migrations, user management, etc. ([Details](./src/cli/README.md))
*   **`src/controllers/`**: Manages incoming API requests, delegates to services, and formulates responses. *(Note: A dedicated README for `src/controllers` was not explicitly created in previous steps, but typically this is where API route handlers would reside.)*
*   **`src/database/`**: Likely contains database connection logic, schema definitions (e.g., Knex migrations, seeds), and potentially query builders or ORM configurations.
*   **`src/helpers/`**: A collection of utility functions, shared services, and helper classes used across the application. This includes sub-modules for environment variable handling, error management, logging, memory management (like the event bus factory), and various node.js or general utilities. ([Details for `src/helpers/utils/README.md`](./src/helpers/utils/README.md) and [`src/helpers/memory/README.md`](./src/helpers/memory/README.md))
*   **`src/services/`**: Contains business logic, interacting with data sources and performing core application tasks.
*   **`src/specs/`**: Houses the OpenAPI specification for the API, defining its endpoints, request/response schemas, and other metadata in a modular way. ([Details](./src/specs/README.md))
*   **`src/storage/`**: Provides a flexible storage abstraction layer for managing files across different drivers like local filesystem, S3, Azure Blob Storage, and GCS. ([Details](./src/storage/README.md))
*   **`src/websocket/`**: Implements WebSocket communication, enabling real-time updates, subscriptions, and GraphQL over WebSockets. ([Details](./src/websocket/README.md))

### Core Application Files (`src/`)

Beyond the modular directories, several files at the root of `src/` are crucial for the application's assembly and operation:

*   **`start.ts`**: The main entry point of the application. It imports and calls `startServer()` from `server.ts`.
*   **`server.ts`**: Responsible for creating and starting the HTTP/S server. It initializes the Express application (via `app.ts`), integrates WebSocket controllers, manages graceful shutdown using Terminus, and handles request/response logging and metrics.
*   **`app.ts`**: Creates and configures the core Express application. This includes setting up middleware (security headers, CORS, body parsers, logging, rate limiting, authentication), registering API routes by mounting various controller routers, and configuring error handling. It also handles initial validations (database, environment) and registers authentication providers.
*   **`auth.ts`**: (Located at `src/auth.ts`, distinct from `src/auth/`) Manages the registration and retrieval of authentication providers (e.g., local, OAuth2, LDAP). It reads environment configurations to dynamically instantiate and make available the chosen authentication strategies.
*   **`emitter.ts`**: Implements a global event emitter system (using `eventemitter2`) with distinct channels for "filter", "action", and "init" events. This facilitates decoupled communication between different parts of the application.
*   **`cache.ts`**: Manages various caching layers (application cache, system cache, local schema cache, lock cache) using `keyv`. Supports memory and Redis backends, Gzip compression for cached values, and cross-instance cache invalidation via the event bus.
*   **`mailer.ts`**: Provides a factory for obtaining a Nodemailer transporter instance, configured based on environment variables to support various email transports (SMTP, SendGrid, Mailgun, SES, development logging).
*   **`rate-limiter.ts`**: Offers a factory function to create rate limiter instances (using `rate-limiter-flexible`) for both memory and Redis stores, configured via environment variables. These are then used as middleware in `app.ts`.
*   **`synchronization.ts`**: Provides a `SynchronizedClock` class and a synchronization manager (supporting memory or Redis backends) for coordinating actions or maintaining a consistent sense of time/order across distributed instances.
*   **`constants.ts`**: Defines a wide range of application-wide constants, including asset transformation parameters, query variables, data types, cookie options, and default settings, many of which are derived from environment configurations.

## Getting Started

### Prerequisites

- Node.js (version specified in `package.json`)
- pnpm (recommended package manager)
- PostgreSQL (recommended database)
- Docker (optional, for containerized deployment)

### Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd api-generator
```

2. Install dependencies:
```bash
pnpm install
```

### Environment Configuration

The application uses environment variables for configuration. The recommended way to generate your initial `.env` file is through the interactive `init` command (see Project Initialization below). However, you can also manually configure these settings:

#### General Settings
- `HOST`: IP or host the API listens on (default: "0.0.0.0")
- `PORT`: The port YP will run on (default: 8055)
- `PUBLIC_URL`: The URL where your API can be reached on the web (default: "/")
- `LOG_LEVEL`: What level of detail to log (default: "info", options: "fatal", "error", "warn", "info", "debug", "trace", "silent")
- `LOG_STYLE`: Render logs as human readable or JSON (default: "pretty", options: "pretty", "raw")
- `MAX_PAYLOAD_SIZE`: Maximum request body size (default: "1mb")
- `GRAPHQL_INTROSPECTION`: Enable GraphQL Introspection (default: true)
- `QUERY_LIMIT_DEFAULT`: Default limit for items per query (default: 100)
- `QUERY_LIMIT_MAX`: Maximum limit for items per query (default: Infinity)
- `MAX_BATCH_MUTATION`: Maximum items for batch mutations (default: "Infinity")
- `REDIS`: Redis server URL for caching, rate limiting, etc. (default: "redis://@127.0.0.1:6379")

#### Database Configuration
- `DB_CLIENT`: Database client (e.g., "pg" for PostgreSQL)
- `DB_HOST`: Database host (default: "localhost")
- `DB_PORT`: Database port (default: 5432)
- `DB_DATABASE`: Database name
- `DB_USER`: Database user (default: "postgres")
- `DB_PASSWORD`: Database password

#### Rate Limiting
- `RATE_LIMITER_ENABLED`: Enable rate limiting (default: false)
- `RATE_LIMITER_STORE`: Store type for rate limiter (default: "memory", options: "memory", "redis")
- `RATE_LIMITER_POINTS`: Allowed hits per duration (default: 25)
- `RATE_LIMITER_DURATION`: Time window in seconds (default: 1)

#### Caching
- `CACHE_ENABLED`: Enable caching (default: false)
- `CACHE_TTL`: Cache persistence duration (default: "5m")
- `CACHE_NAMESPACE`: Cache data scope (default: "system-cache")
- `CACHE_AUTO_PURGE`: Auto-purge cache on changes (default: false)
- `CACHE_AUTO_PURGE_IGNORE_LIST`: Collections to ignore during cache purge (default: "yp_activity,yp_presets")
- `CACHE_STORE`: Cache store type (default: "memory", options: "memory", "redis")
- `ASSETS_CACHE_TTL`: Browser cache duration for assets (default: "30d")

#### File Storage
- `STORAGE_LOCATIONS`: CSV of storage locations (default: "local")
- `STORAGE_LOCAL_DRIVER`: Local storage driver (default: "local")
- `STORAGE_LOCAL_ROOT`: Local storage root directory (default: "./uploads")
- `FILE_METADATA_ALLOW_LIST`: Metadata keys to collect during upload (default: "ifd0.Make,ifd0.Model,exif.FNumber,exif.ExposureTime,exif.FocalLength,exif.ISOSpeedRatings")

#### Security
- `SECRET`: Secret string for the project
- `ACCESS_TOKEN_TTL`: Access token validity duration (default: "15m")
- `REFRESH_TOKEN_TTL`: Refresh token validity duration (default: "7d")
- `REFRESH_TOKEN_COOKIE_SECURE`: Set secure attribute for refresh token cookie (default: false)
- `REFRESH_TOKEN_COOKIE_SAME_SITE`: SameSite value for refresh token cookie (default: "lax")
- `REFRESH_TOKEN_COOKIE_NAME`: Name of refresh token cookie (default: "yp_refresh_token")
- `REFRESH_TOKEN_COOKIE_DOMAIN`: Domain for refresh token cookie
- `SESSION_COOKIE_TTL`: Session cookie validity duration (default: "1d")
- `SESSION_COOKIE_SECURE`: Set secure attribute for session cookie (default: false)
- `SESSION_COOKIE_SAME_SITE`: SameSite value for session cookie (default: "lax")
- `SESSION_COOKIE_NAME`: Name of session cookie (default: "yp_session_token")
- `SESSION_COOKIE_DOMAIN`: Domain for session cookie
- `LOGIN_STALL_TIME`: Login request stall duration in milliseconds (default: 500)
- `CORS_ENABLED`: Enable CORS headers (default: false)
- `CORS_ORIGIN`: Access-Control-Allow-Origin value (default: false)
- `CORS_METHODS`: Allowed HTTP methods (default: "GET,POST,PATCH,DELETE")
- `CORS_ALLOWED_HEADERS`: Allowed headers (default: "Content-Type,Authorization")
- `CORS_EXPOSED_HEADERS`: Exposed headers (default: "Content-Range")
- `CORS_CREDENTIALS`: Allow credentials (default: true)
- `CORS_MAX_AGE`: CORS preflight cache duration (default: 18000)

#### Argon2 (Password Hashing)
- `HASH_MEMORY_COST`: Memory usage for hashing in KiB (default: 4096)
- `HASH_HASH_LENGTH`: Hash output length in bytes (default: 32)
- `HASH_TIME_COST`: Hash function iterations (default: 3)
- `HASH_PARALLELISM`: Number of threads for hash computation (default: 1)
- `HASH_TYPE`: Hash function variant (default: 2, options: 0=argon2d, 1=argon2i, 2=argon2id)
- `HASH_ASSOCIATED_DATA`: Optional non-secret value included in digest

#### Auth Providers
- `AUTH_PROVIDERS`: Comma-separated list of auth providers (e.g., "github")
- `AUTH_GITHUB_DRIVER`: GitHub OAuth driver (default: "oauth2")
- `AUTH_GITHUB_CLIENT_ID`: GitHub OAuth client ID
- `AUTH_GITHUB_CLIENT_SECRET`: GitHub OAuth client secret
- `AUTH_GITHUB_AUTHORIZE_URL`: GitHub OAuth authorize URL
- `AUTH_GITHUB_ACCESS_URL`: GitHub OAuth access token URL
- `AUTH_GITHUB_PROFILE_URL`: GitHub user profile URL
- `AUTH_GITHUB_ALLOW_PUBLIC_REGISTRATION`: Allow public registration via GitHub
- `AUTH_GITHUB_DEFAULT_ROLE_ID`: Default role ID for GitHub users
- `AUTH_GITHUB_ICON`: GitHub provider icon
- `AUTH_GITHUB_LABEL`: GitHub provider label
- `AUTH_GITHUB_EMAIL_KEY`: GitHub email field key
- `AUTH_GITHUB_IDENTIFIER_KEY`: GitHub identifier field key

#### Email Configuration
- `EMAIL_FROM`: Email address for sending emails (default: "no-reply@example.com")
- `EMAIL_TRANSPORT`: Email transport type (default: "sendmail", options: "sendmail", "smtp", "mailgun", "sendgrid", "ses")
- `EMAIL_SENDMAIL_NEW_LINE`: New line style for sendmail (default: "unix")
- `EMAIL_SENDMAIL_PATH`: Path to sendmail executable (default: "/usr/sbin/sendmail")
- `EMAIL_SMTP_HOST`: SMTP host
- `EMAIL_SMTP_POOL`: Use SMTP pooling
- `EMAIL_SMTP_PORT`: SMTP port
- `EMAIL_SMTP_SECURE`: Use TLS for SMTP
- `EMAIL_SMTP_IGNORE_TLS`: Ignore TLS for SMTP
- `EMAIL_SMTP_USER`: SMTP username
- `EMAIL_SMTP_PASSWORD`: SMTP password
- `EMAIL_MAILGUN_API_KEY`: Mailgun API key
- `EMAIL_MAILGUN_DOMAIN`: Mailgun domain
- `EMAIL_SENDGRID_API_KEY`: SendGrid API key

### Authentication Modes

The API supports different authentication modes to cater to various client types and security requirements. The mode determines how authentication tokens (access and refresh tokens) are exchanged and managed between the client and the server. These modes are typically configured on the client-side or inferred by the server based on the request.

Refer to the `src/auth/README.md` for more in-depth details on the authentication system's architecture.

#### 1. `json` Mode

- **Token Delivery**: Upon successful login, the API returns both the `access_token` and `refresh_token` directly within the JSON response body.
- **Client Handling**:
    - The client application is responsible for securely storing these tokens.
    - The `access_token` (short-lived) is typically stored in memory (e.g., JavaScript variable, state management store).
    - The `refresh_token` (long-lived) should be stored more securely. For web clients, if not using cookies for refresh tokens, `localStorage` can be used, though it's susceptible to XSS attacks. For mobile/server clients, secure storage mechanisms specific to the platform are used.
    - For subsequent API requests, the client includes the `access_token` in the `Authorization` header (e.g., `Authorization: Bearer <access_token>`).
- **Refresh Mechanism**:
    - When the `access_token` expires, the API will respond with an error (typically 401 Unauthorized).
    - The client detects this, then sends its stored `refresh_token` to the API's `/auth/refresh` endpoint.
    - If the `refresh_token` is valid, the API issues a new `access_token` (and potentially a new `refresh_token`) in the JSON response.
    - The client updates its stored tokens and retries the original failed request with the new `access_token`.

#### 2. `session` Mode

This mode uses HttpOnly cookies for enhanced security, making it suitable for web browser clients (like Next.js applications).

- **Token Delivery**:
    - Upon successful login, the API sets an `access_token` as an HttpOnly cookie (default name `yp_session_token` via the `SESSION_COOKIE_NAME` environment variable). This cookie is the primary token for the session.
    - The **refresh token is embedded within the JWT payload of this `access_token`** (specifically, it's stored in the `session` claim of the JWT). No separate refresh token cookie (like `REFRESH_TOKEN_COOKIE_NAME`) is set by default in this mode for local authentication.
- **Client Handling (e.g., Next.js)**:
    - The browser automatically sends the session cookie (`yp_session_token`) with every subsequent request to the API's domain (if path and domain attributes match).
    - Client-side JavaScript cannot directly access this HttpOnly cookie.
    - For Next.js applications:
        - **Server Components & API Routes**: Can directly access incoming cookies (e.g., using `next/headers` `cookies()`) and should forward them when making requests to this API.
        - **Client Components**: Should make authenticated requests through Next.js API routes (acting as a Backend-for-Frontend or proxy) which then handle cookie forwarding to this API.
- **Refresh Mechanism**:
    1.  When the `access_token` (session cookie) expires, or if the client needs to pre-emptively refresh, the client makes a request to the `/auth/refresh` endpoint.
    2.  The browser automatically sends the (now potentially expired) `yp_session_token` cookie with this refresh request.
    3.  The API's `/auth/refresh` endpoint reads this `yp_session_token` cookie. It verifies the JWT's signature (even if the token is expired based on time) and extracts the embedded refresh token value from its `session` claim.
    4.  This extracted refresh token is then validated against the session store.
    5.  If the extracted refresh token is valid, a new `access_token` (again, containing a new or the same refresh token in its `session` claim) is generated.
    6.  This new `access_token` is then set as a new `yp_session_token` HttpOnly cookie in the response to the `/auth/refresh` call.
    7.  The client, upon successful refresh (the new cookie is set by the browser), can retry the original request that may have failed.
    8.  If the embedded refresh token is invalid or the session is not found, the `/auth/refresh` endpoint returns a 401 Unauthorized error, and the client should prompt the user to re-authenticate.

Choosing the right mode depends on your client's capabilities and security posture. For web applications, `session` mode with HttpOnly cookies provides a robust and secure approach.

### Project Initialization

The project includes a powerful CLI tool for setting up and managing your application. The recommended way to get started is using the interactive `init` command:

```bash
pnpm yp:init
```

This command will:
- Guide you through setting up your project name
- Help you configure your database connection
- Create and configure your database
- Set up initial system tables and run migrations
- Create your first admin user
- Generate a `.env` file with all necessary configurations

For more details about the CLI and its available commands, see [CLI Documentation](./src/cli/README.md).

### Available CLI Commands

The CLI provides several commands for managing your application:

- `pnpm yp:init`: Interactive project setup wizard
- `pnpm yp:bootstrap`: Programmatic database initialization
- `pnpm migrate:latest`: Run database migrations to latest version
- `pnpm migrate:up`: Run the next pending migration
- `pnpm migrate:down`: Roll back the last migration
- `pnpm database:install`: Install initial database schema and system data
- `pnpm cli`: Run the CLI directly (for advanced usage)

For a complete list of commands and their options, see [CLI Documentation](./src/cli/README.md).

### Starting the Application

After initialization, you can start the application:

```bash
pnpm start
```

Or in development mode:

```bash
pnpm dev
```

## Testing

The project uses Vitest for testing. Tests can typically be run using:

```bash
pnpm test
```

Refer to `vitest.config.ts` for testing configuration details.

## Contributing

*(Placeholder for contribution guidelines.)*

## License

*(Placeholder for license information, e.g., MIT, Apache 2.0.)*
