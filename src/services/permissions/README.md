# Permissions Service Documentation

This document provides an overview of the Permissions Service, located in `src/services/permissions/`. This service is responsible for managing and evaluating user permissions within the application, determining what actions users can perform on various collections and items.

## Core Concepts

The Permissions Service revolves around the idea of "permissions" which define what a user or role can do. Each permission typically specifies:

*   **Collection:** The data collection the permission applies to (e.g., `users`).
*   **Action:** The type of operation being permitted (e.g., `create`, `read`, `update`, `delete`).
*   **Role:** The user role this permission is associated with.
*   **Fields:** (Optional) A list of specific fields within the collection that the action is restricted to.
*   **Presets:** (Optional) Default values to be applied when creating or updating items under this permission.
*   **Validation:** (Optional) Rules or conditions that must be met for the action to be allowed.

The service checks a user's accountability (which includes their role and admin status) against these defined permissions to authorize or deny actions.

## Key Components

### 1. `PermissionsService` (`src/services/permissions/index.ts`)

This is the main class for interacting with permissions. It extends the base `ItemsService` and is primarily responsible for:

*   **Managing `yp_permissions` Collection:** CRUD operations for permissions stored in the `yp_permissions` database table.
*   **Retrieving Allowed Fields:** The `getAllowedFields(action, collection)` method filters permissions based on the current user's accountability and returns a map of collections to the fields they are allowed to perform the given action on.
*   **Overriding CRUD Methods:**
    *   `readByQuery`: Modifies the read behavior to incorporate app-specific minimal permissions using `withAppMinimalPermissions`.
    *   `createOne`, `createMany`, `updateBatch`, `updateMany`, `upsertMany`, `deleteMany`: These methods clear relevant system and service caches after performing their respective operations to ensure permission changes are reflected immediately.
*   **Calculating Item-Specific Permissions (`getItemPermissions`):**
    *   Determines specific permissions (`update`, `delete`, `share`) for a given item in a collection based on the user's accountability.
    *   Handles singleton collections differently, checking if an item exists to determine if the action should be `create` or `update`.
    *   Leverages the `AuthorizationService` to perform the actual access checks.
    *   For singleton collections and update actions, it also retrieves any presets and field restrictions defined in the user's permissions.
*   **Cache Management:** Interacts with the system cache (`this.systemCache`) and its own service-level cache, clearing them upon modification of permissions data to ensure up-to-date permission evaluation.

### 2. `withAppMinimalPermissions` (`src/services/permissions/lib/with-app-minimal-permissions.ts`)

*   **Purpose:** This utility function is used to augment a given set of permissions with predefined "app access minimal permissions" if the current accountability context indicates an app access (i.e., `accountability?.app === true`).
*   **Functionality:**
    *   It takes the current `accountability`, the `permissions` array (typically retrieved from the database), and a `filter` object.
    *   It filters the `appAccessMinimalPermissions` (a predefined set of permissions likely granting basic access necessary for app functionality) based on the provided `filter` and assigns the current user's role to them.
    *   It then merges these filtered app minimal permissions with the original `permissions` array using an 'or' strategy, effectively granting the user the union of their explicit permissions and the necessary app-level permissions.

## Permission Evaluation Flow (Simplified)

1.  An action is requested by a user (e.g., updating an article).
2.  The system retrieves the user's `accountability` (role, admin status, app access status).
3.  The `AuthorizationService` (often invoked by other services or controllers) is called to check access.
4.  The `AuthorizationService` may query the `PermissionsService` (or use permissions already loaded into the `accountability` object) to find relevant permissions for the user's role, the target collection, and the requested action.
5.  If `accountability.app` is true, `withAppMinimalPermissions` might be used to ensure baseline app access is considered.
6.  The permissions (including field restrictions, validation rules) are evaluated.
7.  Access is granted or denied.
8.  For item-specific views (e.g., determining if an "Edit" button should be shown), `PermissionsService.getItemPermissions()` can be called to get a summary of allowed actions on that specific item.

## Cache Management

The `PermissionsService` actively manages caching to ensure performance and data consistency:

*   **System Cache:** After any CUD (Create, Update, Delete) operation on permissions, `clearSystemCache()` is called. This likely clears a broader cache used across different services that might depend on permission data.
*   **Service Cache:** The `PermissionsService` itself might have a local cache (`this.cache`). This cache is also cleared after CUD operations on permissions if `autoPurgeCache` is not explicitly set to `false`.

This proactive cache clearing ensures that changes to permissions are reflected system-wide as quickly as possible.

## Usage

The `PermissionsService` is typically used internally by the `AuthorizationService` and other parts of the application that need to make decisions based on user permissions. Direct interaction might be needed for administrative interfaces that manage roles and permissions. 