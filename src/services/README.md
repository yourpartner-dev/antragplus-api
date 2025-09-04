# Services Overview

This directory (`src/services/`) is the heart of the application's business logic and data management. It contains various "services", each responsible for handling operations related to specific data entities or functionalities.

## General Pattern

Many services in this application follow a common pattern:

*   **`ItemsService` as a Base:** A significant number of services (e.g., `UsersService`, `RolesService`, `FilesService`) extend the generic `ItemsService` located in `src/services/items.ts`. This base service provides common CRUD (Create, Read, Update, Delete) functionalities for a specific database collection, along with handling for relations, hooks, and basic permission checks.
*   **Specialized Logic:** Services extending `ItemsService` then add specialized logic relevant to the entity they manage. For example, `UsersService` includes methods for password management, user invitations, and email verification.
*   **Accountability & Schema:** Services are typically instantiated with `accountability` (representing the current user and their permissions) and `schema` (the overall application data schema).
*   **Database Interaction:** Services interact directly with the database (Knex.js instance) to persist and retrieve data.
*   **Event Emission:** Services often emit events (using `emitter.js`) before and after actions (e.g., `items.create`, `users.update.after`), allowing other parts of the application (like hooks) to react to these changes.

## Core Top-Level Services

Below is a description of some key files found directly within `src/services/`. More specialized services are often located in their respective subdirectories (e.g., `mail/`, `graphql/`, `permissions/`), each with their own `README.md` providing detailed documentation.

### `index.ts`
*   **Purpose:** Acts as the main aggregator and export point for all core services and service submodules. This allows other parts of the application to import services from a central location.

### `items.ts` (`ItemsService`)
*   **Purpose:** Provides a generic, reusable service for performing CRUD operations on any database collection defined in the schema.
*   **Key Features:**
    *   Handles creating, reading (by query, by ID, many), updating (by query, by ID, batch, many), and deleting (by query, by ID, many) items.
    *   Manages relational data (M2O, A2O) during create/update operations through `PayloadService`.
    *   Integrates with `AuthorizationService` to validate payloads and apply permission-based presets.
    *   Emits events before and after actions.
    *   Supports database transactions for atomic operations.
    *   Provides a `fork()` method to create new service instances with modified options.
    *   Includes logic for handling cache clearing.

### `organizations.ts` (`OrganizationsService`)
*   **Purpose:** Manages organization-specific operations, extending `ItemsService` for the `yp_organizations` collection.
*   **Key Features:**
    *   Handles organization logo management through integration with `FilesService`.
    *   Automatically manages file cleanup when updating or deleting organization logos.
    *   Supports both file ID references and direct file uploads for logos.
    *   Implements proper error handling for file operations.
    *   Maintains data integrity by cleaning up associated files during organization deletion.

### `users.ts` (`UsersService`)
*   **Purpose:** Manages user-specific operations, extending `ItemsService` for the `yp_users` collection.
*   **Key Features:**
    *   Enforces email uniqueness (case-insensitive) and password policies (configurable via settings).
    *   Handles user invitation flows (generating invite URLs, accepting invites).
    *   Manages user registration, including email verification.
    *   Provides password reset functionality.
    *   Ensures that admin users cannot be entirely removed or all made inactive, preserving system access.
    *   Interacts with `MailService` to send emails for invitations, verification, and password resets.

### `roles.ts` (`RolesService`)
*   **Purpose:** Manages roles and their associated permissions, extending `ItemsService` for the `yp_roles` collection.
*   **Key Features:**
    *   Validates `ip_access` lists for roles.
    *   Prevents deletion of the last admin role or removal of all admin users from admin roles.
    *   Interacts with `PermissionsService` when dealing with permissions linked to roles.

### `authentication.ts` (`AuthenticationService`)
*   **Purpose:** Handles all aspects of user authentication.
*   **Key Features:**
    *   Provides `login()` method supporting different authentication providers (e.g., local password, SSO) via `getAuthProvider()`.
    *   Manages JWT-based access tokens and refresh tokens (stored in `yp_sessions`).
    *   Handles Two-Factor Authentication (TFA/OTP) verification during login if enabled for a user.
    *   Implements rate limiting for login attempts to prevent brute-force attacks.
    *   Provides `logout()` to invalidate refresh tokens.
    *   Includes `verifyPassword()` for checking a user's current password.
    *   Logs authentication activity using `ActivityService`.

### `authorization.ts` (`AuthorizationService`)
*   **Purpose:** Central service for access control and permission enforcement throughout the application.
*   **Key Features:**
    *   `processAST()`: Validates an Abstract Syntax Tree (AST) of a data query against user permissions. It checks if the user has permission for the requested collections and fields, and applies permission-based filters to the query.
    *   `validatePayload()`: Validates data payloads for create/update operations against the user's permissions for the target collection and action. It can also apply default presets defined in permissions.
    *   `checkAccess()`: Performs a direct permission check for a given action, collection, and optional primary key(s).
    *   Works closely with the `permissions` array in the `Accountability` object.

### Other Notable Top-Level Files:

*   **`activity.ts` (`ActivityService`):** Manages logging user and system activities (e.g., logins, item creation/updates). Extends `ItemsService` for `yp_activity`.
*   **`assets.ts` (`AssetsService`):** Likely handles transformations and delivery of assets (images, files), possibly integrating with storage adapters and the file processing utilities in `src/services/files/`.
*   **`files.ts` (`FilesService`):** Manages file records and metadata. Extends `ItemsService` for `yp_files`.
*   **`folders.ts` (`FoldersService`):** Manages folder records. Extends `ItemsService` for `yp_folders`.
*   **`meta.ts` (`MetaService`):** Provides metadata about the application, schema, and collections.
*   **`notifications.ts` (`NotificationsService`):** Likely handles creating and managing user notifications. Extends `ItemsService` for `yp_notifications`.
*   **`payload.ts` (`PayloadService`):** A utility service used internally by other services (especially `ItemsService`) to process and prepare data payloads before database operations. It handles relational data (M2O, A2O), type casting, and generating revision data.
*   **`revisions.ts` (`RevisionsService`):** Manages item revisions (version history). Extends `ItemsService` for `yp_revisions`.
*   **`server.ts` (`ServerService`):** Provides information and utilities related to the server environment and application state (e.g., server ping, OpenAPI specs, schema info).
*   **`settings.ts` (`SettingsService`):** Manages application settings. Extends `ItemsService` for `yp_settings` (which is a singleton collection).
*   **`specifications.ts` (`SpecificationService`):** Manages data specifications or schemas, potentially for dynamic form generation or data validation. Extends `ItemsService` for `yp_specs`.
*   **`tfa.ts` (`TFAService`):** Handles Two-Factor Authentication setup (enable/disable, generate QR codes/secrets) and OTP verification.
*   **`utils.ts` (`UtilsService`):** Provides miscellaneous utility functions that can be exposed via an API, such as hashing or random string generation.
*   **`websocket.ts` (`WebsocketService`):** Manages WebSocket connections and real-time communication, possibly related to GraphQL subscriptions or other live updates.
*   **`import-export.ts` (`ImportExportService`):** Handles data import and export functionalities.

For detailed information on services within subdirectories (like `graphql`, `mail`, `permissions`, `queues`, `tus`), please refer to the `README.md` files located within those specific directories. 