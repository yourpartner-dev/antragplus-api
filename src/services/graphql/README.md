# GraphQL Service Documentation

This document provides an overview of the GraphQL Service, located in `src/services/graphql/`. This service dynamically generates and serves a GraphQL API based on the application's schema and user permissions.

## Core Functionality

*   **Dynamic Schema Generation:** Builds a GraphQL schema using `graphql-compose` based on the existing application schema (`SchemaOverview`).
*   **Permission-Aware:** The generated schema is tailored to the requesting user's permissions. Users can only see and interact with collections and fields they have access to.
*   **Query, Mutation, and Subscription Support:**
    *   Handles GraphQL queries for reading data.
    *   Handles GraphQL mutations for creating, updating, and deleting data.
    *   Supports GraphQL subscriptions for real-time updates.
*   **Caching:** Implements LRU caching for generated schemas to improve performance.
*   **Custom Scalar Types:** Defines and uses custom GraphQL scalar types (e.g., for BigInt, Date, GeoJSON, Hash).
*   **Error Handling:** Provides specific GraphQL error types and processing.

## Key Components

### 1. `GraphQLService` (`src/services/graphql/index.ts`)

This is the central class of the GraphQL service.

*   **Constructor:** Initializes with `accountability`, `knex` (database connection), `schema` (application schema), and `scope` (`items` or `system`). The scope determines whether to generate a schema for regular data collections or system collections.
*   **`getSchema(type: 'schema' | 'sdl')`:**
    *   The core method for generating the GraphQL schema.
    *   It checks a cache (`schema-cache.ts`) first.
    *   Uses `graphql-compose` (`SchemaComposer`) to build the schema.
    *   Sanitizes the application schema using `sanitizeGraphqlSchema`.
    *   Reduces the schema based on the user's permissions (`this.accountability.permissions`) for read, create, update, and delete operations.
    *   Dynamically creates GraphQL types for each collection and its fields, respecting field types (string, number, boolean, JSON, relations, etc.).
    *   Injects resolvers for queries (e.g., `collection_by_id`, `collection_aggregated`), mutations (e.g., `create_collection_item`, `update_collection_items`, `delete_collection_items`), and system-specific resolvers if `scope` is `'system'` (e.g., for authentication, server info, utilities).
    *   Handles special GraphQL types like `GraphQLJSON`, custom scalars (`GraphQLBigInt`, `GraphQLDate`, etc.), and enums.
    *   Returns either a `GraphQLSchema` object or its SDL string representation.
*   **`execute(params: GraphQLParams)`:**
    *   Takes GraphQL parameters (`document`, `variables`, `operationName`, `contextValue`).
    *   Retrieves the appropriate schema using `getSchema()`.
    *   Validates the GraphQL document against the schema and configured validation rules (including optional introspection disabling via `GRAPHQL_INTROSPECTION` env var).
    *   Executes the query/mutation using `graphql.execute()`.
    *   Formats the result, processing any errors using `processError`.
*   **Resolvers (e.g., `resolveQuery`, `resolveMutation`, `read`):**
    *   These methods are used internally by the generated resolvers to fetch data or perform actions. They typically:
        *   Parse arguments and query fields from the `GraphQLResolveInfo`.
        *   Interact with other services (e.g., `ItemsService`, `UsersService`, `FilesService`) to perform the underlying database operations or business logic.
        *   Respect accountability and permissions.
*   **Argument and Query Parsing (`parseArgs`, `getQuery`, `getAggregateQuery`):**
    *   Helper methods to translate GraphQL arguments and selection sets into the query objects expected by the application's services.
*   **System Resolvers (`injectSystemResolvers`):**
    *   A dedicated method to add system-level queries and mutations to the schema when `this.scope === 'system'`. This includes operations related to:
        *   Server information (`serverPing`, `serverInfo`, `serverOpenAPI`)
        *   Authentication (`authLogin`, `authRefresh`, `authLogout`, `authPasswordRequest`, `authPasswordReset`)
        *   TFA (`tfaEnable`, `tfaDisable`, `tfaGenerate`)
        *   Current User (`usersMe`)
        *   Utilities (`utilsHashGenerate`, `utilsHashVerify`, `utilsRandomString`)
        *   Schema management (`schemaSnapshot`, `schemaApply`, `schemaDiff`)
        *   File import (`filesImport`)

### 2. Schema Cache (`src/services/graphql/schema-cache.ts`)

*   **Purpose:** Caches generated `GraphQLSchema` objects or their SDL string representations to avoid regenerating them on every request.
*   **Implementation:** Uses an LRU (Least Recently Used) cache (`mnemonist/lru-map`).
*   **Capacity:** Configurable via the `GRAPHQL_SCHEMA_CACHE_CAPACITY` environment variable.
*   **Invalidation:** Subscribes to a `schemaChanged` event on the application's event bus (`useBus()`). When this event occurs (e.g., after a migration changes the database schema), the cache is cleared.

### 3. Subscriptions (`src/services/graphql/subscription.ts`)

*   **Purpose:** Handles GraphQL subscriptions for real-time updates.
*   **`createSubscriptionGenerator(self: GraphQLService, event: string)`:**
    *   Creates an async generator function that will be used as the resolver for subscription fields.
    *   Subscribes to an internal pub/sub mechanism (`messages`) that is fed by `websocket.event` bus events.
    *   When a relevant event occurs (e.g., an item in a collection is created, updated, or deleted):
        *   It refreshes the user's accountability.
        *   It constructs a payload based on the subscription query's requested fields and permissions.
        *   It `yield`s the data to the subscribed client.
*   **`bindPubSub()`:** Connects the internal `messages` pub/sub to the main application event bus for `websocket.event` messages.
*   **Argument & Field Parsing:** Includes helpers (`parseFields`, `parseArguments`) to get the necessary information from the subscription request.

### 4. Custom Scalar Types (`src/services/graphql/types/`)

This directory defines custom GraphQL scalar types used in the schema:

*   `bigint.ts`: `GraphQLBigInt` for large integer values.
*   `date.ts`: `GraphQLDate` for date values.
*   `geojson.ts`: `GraphQLGeoJSON` for GeoJSON objects.
*   `hash.ts`: `GraphQLHash` for password hashes or other hash strings.
*   `string-or-float.ts`: `GraphQLStringOrFloat` for values that can be either a string or a float.
*   `void.ts`: `GraphQLVoid` for operations that don't return a value.

### 5. Error Handling (`src/services/graphql/errors/`)

*   Defines custom GraphQL error classes:
    *   `GraphQLExecutionError` (`execution.ts`)
    *   `GraphQLValidationError` (`validation.ts`)
*   The `processError` utility (`src/services/graphql/utils/process-error.ts`) is used to format errors before sending them to the client, potentially masking sensitive information based on user accountability.

### 6. Utilities (`src/services/graphql/utils/`)

*   `process-error.ts`: Formats errors for GraphQL responses.
*   `sanitize-gql-schema.ts`: Cleans up the application schema to make it suitable for GraphQL (e.g., renaming, removing incompatible parts).
*   `add-path-to-validation-error.ts`: Adds path information to GraphQL validation errors.

## Workflow

1.  A GraphQL request arrives at the server.
2.  The `GraphQLService` is instantiated with the current user's accountability and the relevant scope (`items` or `system`).
3.  `getSchema()` is called:
    *   If a cached schema for the user's role and scope exists, it's used.
    *   Otherwise, a new schema is dynamically generated based on the application schema and user permissions.
    *   The new schema is cached.
4.  `execute()` is called:
    *   The incoming GraphQL query/mutation is validated against the schema.
    *   If valid, it's executed. Resolvers defined during schema generation fetch data or perform actions, often by calling other services.
    *   The result (data and/or errors) is returned.
5.  For subscriptions, the `createSubscriptionGenerator` sets up a listener for relevant backend events and pushes data to the client when these events occur and permission checks pass.

## Configuration

*   `GRAPHQL_INTROSPECTION` (boolean): Enables or disables GraphQL schema introspection. Defaults to true. Set to false to disable.
*   `GRAPHQL_SCHEMA_CACHE_CAPACITY` (number): The maximum number of GraphQL schemas to keep in the LRU cache. Defaults to 100. 