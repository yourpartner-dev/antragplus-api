# Hooks Module Documentation

This document provides an overview of the event hook system used in this project. Hooks allow for custom actions to be performed in response to specific events occurring within the system (e.g., item creation, update, deletion), primarily tailored for PostgreSQL and extended with custom business logic.

## Core Concepts

Hooks in this system are event-driven. An `emitter` object is used to listen for specific actions (events) and trigger corresponding handler functions. These actions typically follow the pattern `collection.event_type`, such as `clients.items.create` or `file_shares.items.delete`.

### Creating a Hook

Hooks are defined by subscribing a function to an event on the global `emitter`.

**General Structure:**

```typescript
import emitter from '../emitter.js'; // Path to your event emitter
import { useLogger } from '../helpers/logger/index.js';
import { Accountability, SchemaOverview, Item } from '../types/index.js'; // Relevant types
// Potentially import services like ItemsService, QueueManager, etc.
// import { ItemsService } from '../services/index.js';
// import getDatabase from '../database/index.js'; // For direct Knex access

emitter.onAction('collection_name.items.event_type', async (meta, context) => {
    const logger = useLogger(); // Initialize logger for this hook

    try {
        // Extract relevant data from meta and context
        const keys = meta['keys']; // Array of primary keys for the items affected (for update/delete)
        const key = meta['key']; // Primary key of the item affected (for create)
        const payload = meta['payload']; // Data being inserted or updated, or data of items before deletion
        const accountability: Accountability = context.accountability as Accountability;
        const schema: SchemaOverview = context.schema as SchemaOverview;

        logger.info(`Hook triggered for collection_name.items.event_type with key(s): ${keys || key}`);

        // --- Your custom logic here ---
        // Example: Fetching related data
        // const itemService = new ItemsService('some_collection', { schema, accountability });
        // const items = await itemService.readByQuery({...});

        // Example: Direct database interaction with Knex
        // const knex = getDatabase();
        // await transaction(knex, async (trx) => {
        //     // Database operations within a transaction
        // });

        logger.info(`Successfully processed hook for collection_name.items.event_type`);

    } catch (error) {
        logger.error(`Error in collection_name.items.event_type hook:`);
        logger.error(error);
    }
});
```

**Key Parameters:**

*   `meta`: An object containing event-specific data.
    *   `meta['key']`: The primary key of the item involved (typically for create events).
    *   `meta['keys']`: An array of primary keys of the items involved (typically for update/delete events).
    *   `meta['payload']`:
        *   For `create`: The data of the item being created.
        *   For `update`: The data being applied in the update.
        *   For `delete`: The data of the item(s) *before* deletion.
*   `context`: An object containing contextual information.
    *   `context.accountability`: Provides information about the user and role performing the action.
    *   `context.schema`: An overview of the database schema.
    *   `context.database` (implicitly available via `getDatabase()`): A Knex instance for direct database interaction.

### Registering Hooks with the Application

For the defined hooks to become active and listen to events, they need to be loaded by the application when it starts. This is typically done by:

1.  Ensuring each file containing hook definitions (e.g., `my-custom-hooks.ts`) is created within the `src/hooks/` directory.
2.  These individual hook files are often imported into a central `index.ts` file within the `src/hooks/` directory. This `index.ts` file then serves as a single point of entry for all hooks.

    **Example (`src/hooks/index.ts`):**
    ```typescript
    import './file_name.js'; // Assuming this file contains emitter.onAction(...) calls
    // ... import other hook files
    ```
3.  Finally, this central `src/hooks/index.ts` file is imported at an appropriate place in your main application setup, typically in `src/app.ts`, usually early in the bootstrap process.

    **Example (Conceptual import in `src/app.ts`):**
    ```typescript
    // ... other imports in app.ts
    import './hooks/index.js'; // This ensures all hooks are registered
    // ... rest of app.ts
    
    export default async function createApp(): Promise<express.Application> {
        // ... app initialization logic ...
        
        // The import './hooks/index.js'; itself is often enough if hooks
        // are self-registering upon import (which is the case when
        // emitter.onAction is called at the top level of a hook file).
        
        // ... rest of app setup
        return app;
    }
    ```

By importing the hook files, the `emitter.onAction(...)` calls within them are executed, registering the listeners with the event emitter.

## Common Patterns & Best Practices

*   **Logging:** `useLogger()` is consistently used within each hook for robust logging of actions and errors. This is crucial for debugging and monitoring.
*   **Contextual Data:** `Accountability` and `SchemaOverview` from the `context` object are standard parameters, providing necessary permissions and schema information.
*   **Direct Database Access (`knex`):** For operations requiring transactions or fine-grained control (especially in high-frequency or complex scenarios like translation syncing in `asset-shares.ts`), `knex` (the SQL query builder) is used directly via `getDatabase()` and often wrapped in a `transaction()` helper. This can offer performance benefits and atomicity compared to always going through the `ItemsService` layer.
*   **Service Layer Usage (`ItemsService`, `FilesService`):** For standard CRUD operations, services like `ItemsService` are utilized, abstracting away direct database calls.
*   **Queueing (`QueueManager`):** For tasks that can be processed asynchronously or might be resource-intensive, a `QueueManager` is used to offload work
*   **Idempotency/Duplicate Prevention:** Several hooks include checks to prevent creating duplicate records if the hook is somehow triggered multiple times with the same effective data (e.g., in `client.ts` when creating shares).
*   **Infinite Loop Prevention:** The `saved_searches.items.update` hook explicitly includes logic to compare data before performing an update. This is vital because an update to a saved search triggers this hook, which then updates other saved searches. Without this check, it could lead to an infinite loop of updates if not carefully managed.

This hook system allows for extending and customizing application behavior by reacting to data events. The `emitter.onAction()` pattern, combined with a consistent approach to handling `meta` and `context` data, provides a structured way to build these extensions. The naming convention `collection.items.event_type` is a common practice for clarity in such event-driven systems. 