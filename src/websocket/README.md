# WebSocket Module (`src/websocket`)

This module implements the WebSocket communication layer for the YP application, enabling real-time, bi-directional communication between clients and the server.

## Overview

The WebSocket module handles:

*   **Connection Management:** Establishing and authenticating WebSocket connections.
*   **Real-time Updates:** Subscribing to changes (create, update, delete) in data collections and receiving live updates.
*   **Message Handling:** Processing various message types for authentication, subscriptions, and potentially direct data operations.
*   **Error Handling:** Providing structured error responses to clients.
*   **GraphQL Integration:** Potentially supporting GraphQL subscriptions over WebSockets.

## Core Components & Concepts

Based on the top-level files, the following core components and concepts are central to this module:

### 1. Types (`types.ts`)

Defines fundamental data structures used throughout the WebSocket implementation:

*   **`AuthenticationState`**: Stores accountability information, token expiration, and an optional refresh token for an authenticated client.
*   **`WebSocketClient`**: Extends the standard `ws.WebSocket` object to include `AuthenticationState`, a unique client `uid`, and an `auth_timer` (likely for session management).
*   **`UpgradeRequest`**: Represents the initial HTTP upgrade request, also carrying `AuthenticationState`.
*   **`SubscriptionEvent`**: Defines the types of data events clients can subscribe to (`'create'`, `'update'`, `'delete'`).
*   **`Subscription`**: Describes a client's subscription to events on a specific `collection`, potentially filtered by a `query` or for a specific `item`.
*   **`UpgradeContext`**: Holds context for the HTTP upgrade event (request, socket, head buffer).
*   **`GraphQLSocket`**: Suggests integration with GraphQL, associating a `WebSocketClient` with a GraphQL context.

### 2. Error Handling (`errors.ts`)

Provides a structured approach to WebSocket error management:

*   **`WebSocketError`**: A custom error class with `type`, `code`, `message`, and an optional `uid` for correlation. It can be serialized to a JSON message for the client.
*   **Factory Methods**: `WebSocketError.fromError()` (for `YPError`) and `WebSocketError.fromZodError()` (for validation errors) allow consistent error object creation.
*   **`handleWebSocketError()`**: A utility function to process different error types, log them, and send a standardized `WebSocketError` message to the client.

### 3. Authentication (`authenticate.ts`)

Manages the authentication of WebSocket connections:

*   **`authenticateConnection()`**: Handles authentication attempts based on:
    *   Email/password (using `AuthenticationService.login()`)
    *   Refresh token (using `AuthenticationService.refresh()`)
    *   Existing access token.
    It retrieves user accountability and token expiration, returning an `AuthenticationState`. Throws a `WebSocketError` on failure.
*   **`refreshAccountability()`**: Updates a client's accountability object with the latest permissions.
*   **`authenticationSuccess()`**: Generates a JSON success message for authentication, optionally including a refresh token.

### 4. Message Schemas (`messages.ts`)

Defines the structure and validation rules for messages exchanged over WebSockets, using the `zod` library:

*   **`WebSocketMessage` (Base)**: Basic message structure with `type` and optional `uid`.
*   **`WebSocketResponse`**: Standardized response format with `status: 'ok'` or `status: 'error'` (including error details).
*   **`ConnectionParams`**: For passing an `access_token` during connection setup.
*   **`WebSocketAuthMessage`**: Schema for authentication requests, incorporating email/password, access token, or refresh token.
*   **`WebSocketSubscribeMessage`**: Schemas for `subscribe` (to collections/items/events with optional queries) and `unsubscribe` messages.
*   **`WebSocketItemsMessage`**: Defines messages for item-related operations (`create`, `read`, `update`, `delete`), including data payloads and query options. This suggests a direct data manipulation capability over WebSockets beyond just event subscriptions.
*   **`WebSocketEvent`**: Schema for events pushed from the server to subscribed clients, detailing the `action` (`create`, `update`, `delete`), `collection`, affected `key`(s), and event `payload` (the actual data).
*   **`AuthMode`**: Defines possible authentication modes: `'public'`, `'handshake'`, `'strict'`.

### 5. Utilities (`utils/`)

This subdirectory contains helper functions used within the WebSocket module:

*   **`get-expires-at-for-token.ts`**: Provides `getExpiresAtForToken(token: string)` which decodes a JWT and returns its `exp` (expiration time) claim, or `null` if not present.
*   **`message.ts`**:
    *   `fmtMessage(type, data, uid)`: A utility to format and stringify a message object.
    *   `safeSend(client, data, delay)`: Attempts to send data reliably, pausing and retrying if the client's send buffer is full. This is useful for handling potentially slow connections.
    *   `getMessageType(message)`: Extracts the `type` property from a parsed message object, with basic safety checks.
*   **`wait-for-message.ts`**:
    *   `waitForAnyMessage(client, timeout)`: Returns a promise that resolves with the next message received from the client within the timeout, or rejects on timeout.
    *   `waitForMessageType(client, type, timeout)`: Returns a promise that resolves with the next message of a specific `type` received from the client (after Zod validation), or rejects on timeout or validation failure.
*   **`items.ts`**:
    *   `getPayload(subscription, accountability, schema, event)`: Constructs the complete data payload to be sent to a subscribed client. This includes the event type (`init`, `create`, `update`, `delete`), the actual data items, and optional metadata (if requested in the subscription query).
    *   `getItemsPayload(subscription, accountability, schema, event)`: Fetches the specific items relevant to a subscription. For single-item subscriptions, it fetches that item. For collection subscriptions, it fetches items based on the event type (e.g., the new item on `create`, updated items on `update`, or all matching items on initial subscription).

### 6. Message Handlers (`handlers/`)

This directory contains class-based handlers for different categories of WebSocket interactions. These handlers are instantiated and likely self-register or are managed by a central controller.

*   **`index.ts`**: Exports `startWebSocketHandlers()`, a function that instantiates `HeartbeatHandler`, `ItemsHandler`, and `SubscribeHandler`. It also re-exports all members from these handler files.

*   **`heartbeat.ts` (`HeartbeatHandler`)**:
    *   Implements a heartbeat mechanism to maintain connection health and detect unresponsive clients.
    *   Reads `WEBSOCKETS_HEARTBEAT_ENABLED` and `WEBSOCKETS_HEARTBEAT_PERIOD` from environment variables.
    *   Periodically sends `'ping'` messages to all connected clients if enabled.
    *   Listens for any message from a client as an acknowledgment of liveness during a ping cycle. Clients that don't send any message within the period are disconnected.
    *   Responds to client-initiated `'ping'` messages with a `'pong'` message.
    *   Manages the start/stop of the ping interval based on the presence of active clients.

*   **`subscribe.ts` (`SubscribeHandler`)**:
    *   Manages client subscriptions to real-time data updates.
    *   Uses an internal `messenger` (event bus, likely Redis-backed via `useBus()`) to listen for `'websocket.event'` messages originating from data changes in the application.
    *   **Subscription Management**:
        *   Handles incoming `'subscribe'` messages from clients: registers subscriptions (to collections, specific events, with queries, or for specific items), and sends an initial data payload or an init marker.
        *   Handles `'unsubscribe'` messages to remove specific or all client subscriptions.
        *   Automatically unsubscribes clients on `websocket.error` or `websocket.close` events.
    *   **Event Dispatching (`dispatch`)**: When a data change event is received from the `messenger`:
        *   It iterates through relevant subscriptions.
        *   Filters based on subscription criteria (event type, specific item ID).
        *   Refreshes client accountability.
        *   Fetches the appropriate data payload using `getPayload()` (from `utils/items.ts`).
        *   Sends the updated data to the subscribed client.

*   **`items.ts` (`ItemsHandler`)**:
    *   Handles direct CRUD (Create, Read, Update, Delete) operations on data items initiated by clients via `'items'` type messages.
    *   Listens for `'items'` messages, parses them with `WebSocketItemsMessage` Zod schema, and processes them.
    *   Validates that the requested collection exists and is not a system collection.
    *   Uses `ItemsService` and `MetaService` to perform actions based on `message.action` (`create`, `read`, `update`, `delete`):
        *   **Create**: Handles `createOne` and `createMany`.
        *   **Read**: Handles `readOne` (by ID), `readMany` (by IDs), `readSingleton`, and `readByQuery`. Also fetches metadata.
        *   **Update**: Handles `updateOne` (by ID), `updateMany` (by IDs), `upsertSingleton`, and `updateByQuery`.
        *   **Delete**: Handles `deleteOne` (by ID), `deleteMany` (by IDs), and `deleteByQuery`.
    *   Sends a response message of type `'items'` back to the client containing the result of the operation (`data`), optional `meta`, and the original `uid` for correlation.

### 7. WebSocket Controllers (`controllers/`)

This directory is responsible for the setup and management of the WebSocket server instances, handling connection upgrades, authentication, and routing messages to appropriate handlers.

*   **`index.ts`**: 
    *   Manages the creation and access to different WebSocket controller instances.
    *   `createWebSocketController(httpServer)`: Creates and stores a general `WebSocketController` (from `rest.ts`) if `WEBSOCKETS_REST_ENABLED` is true.
    *   `createSubscriptionController(httpServer)`: Creates and stores a `GraphQLSubscriptionController` (from `graphql.ts`) if `WEBSOCKETS_GRAPHQL_ENABLED` is true.
    *   Provides getter functions (`getWebSocketController`, `getSubscriptionController`) for these instances.

*   **`base.ts` (`SocketController` - Abstract Class)**:
    *   Provides the core, abstract foundation for concrete WebSocket controller implementations.
    *   **Initialization**: 
        *   Takes an HTTP server instance and a configuration prefix for environment variables.
        *   Creates a `ws.WebSocketServer` instance with `noServer: true` (attaches to the existing HTTP server).
        *   Loads configuration for `endpoint` path, `authentication.mode` (`public`, `handshake`, `strict`), `authentication.timeout`, and `maxConnections` from environment variables.
        *   Optionally initializes a rate limiter (`RATE_LIMITER_ENABLED`).
    *   **HTTP Upgrade Handling (`handleUpgrade`)**: 
        *   Listens to the HTTP server's `'upgrade'` event for the configured `endpoint`.
        *   Manages connection limits.
        *   Implements different authentication flows based on `authentication.mode`:
            *   `'strict'` or token in query/cookie (`handleTokenUpgrade`): Expects a token immediately; validates it and establishes accountability.
            *   `'handshake'` (`handleHandshakeUpgrade`): Upgrades, then waits for an `'auth'` message from the client within a timeout to perform authentication.
            *   `'public'`: Upgrades with null accountability.
        *   Emits a `'connection'` event on the internal `WebSocketServer` instance upon successful upgrade, passing the established `AuthenticationState`.
    *   **Client Management (`createClient`)**: 
        *   Called upon a successful internal `'connection'` event.
        *   Wraps the raw `ws` socket into a `WebSocketClient`, attaching `accountability`, `expires_at`, a unique `uid`, and an `auth_timer`.
        *   Sets up message listeners on the client socket:
            *   Applies rate limiting if configured.
            *   Parses messages using `WebSocketMessage` Zod schema.
            *   Handles subsequent `'auth'` messages by calling `handleAuthRequest` (for re-authentication/token refresh).
            *   For other messages, emits them via the global `emitter` (`websocket.message`) for other handlers to process.
        *   Manages client removal and event emission on `'error'` and `'close'` events.
    *   **Token Expiration Management**:
        *   `setTokenExpireTimer(client)`: Sets a timer for an individual client if their token is close to expiring. On expiry, it nullifies accountability and expects re-authentication within a timeout.
        *   `checkClientTokens()`: Periodically (every 15 mins) iterates all clients and sets specific expiration timers if their tokens are nearing expiry and a timer isn't already active. This avoids too many concurrent `setTimeout` calls.
    *   **Termination (`terminate`)**: Cleans up timers and terminates all client connections.
    *   Uses `registerWebSocketEvents()` (from `hooks.ts`) during initialization, likely to set up global event listeners/emitters.

*   **`hooks.ts` (`registerWebSocketEvents`)**:
    *   This file sets up listeners for various internal application action events (e.g., `items.create`, `users.update`, `files.upload`) using the global `emitter`.
    *   When these actions occur, a `transform` function standardizes the event data into a `WebSocketEvent` format (containing `collection`, `action`, `key`/`keys`, and `payload`).
    *   The transformed `WebSocketEvent` is then published to a message bus (e.g., Redis via `useBus()`) on the `'websocket.event'` channel.
    *   This mechanism decouples the core application logic that triggers events from the WebSocket notification system. The `SubscribeHandler` listens to this bus channel to dispatch updates to subscribed clients.
    *   It registers hooks for common CRUD operations across multiple modules (`items`, `activity`, `notifications`, etc.), file operations, and item sorting.

*   **`rest.ts` (`WebSocketController` - extends `SocketController`)**:
    *   This is the general-purpose WebSocket controller, instantiated if `WEBSOCKETS_REST_ENABLED` is true.
    *   It uses `'WEBSOCKETS_REST'` as the configuration prefix for environment variables.
    *   **Event Binding (`bindEvents`)**: After the base controller establishes a connection, this method:
        *   Listens to the client's internal `'parsed-message'` event.
        *   Passes the message through `emitter.emitFilter('websocket.message', ...)` allowing for potential modification by other parts of the system.
        *   Refreshes client accountability.
        *   Emits the (potentially transformed) message via the global `emitter.emitAction('websocket.message', ...)` for the specialized handlers (`HeartbeatHandler`, `SubscribeHandler`, `ItemsHandler`) to process.
        *   Emits global `websocket.error` and `websocket.close` events.
    *   **Message Parsing Override**: Overrides `parseMessage` to only perform basic JSON parsing, deferring Zod schema validation to later stages (e.g., base class `createClient` or specific handlers).

*   **`graphql.ts` (`GraphQLSubscriptionController` - extends `SocketController`)**:
    *   Handles GraphQL subscriptions over WebSockets, instantiated if `WEBSOCKETS_GRAPHQL_ENABLED` is true.
    *   Uses `'WEBSOCKETS_GRAPHQL'` as the configuration prefix.
    *   Integrates with the `graphql-ws` library (`makeServer`).
    *   **Schema Provision**: Provides a dynamic GraphQL schema to `graphql-ws` based on the connected client's accountability (fetched via `GraphQLService`).
    *   Calls `bindPubSub()` to link GraphQL pub/sub with the application's event system.
    *   **Event Binding (`bindEvents`)**: 
        *   Connects the `WebSocketClient` (from `SocketController`) to the `graphql-ws` server instance (`this.gql.opened`).
        *   Handles `connection_init` messages for authentication if the mode is `'handshake'`, expecting an `access_token` in the payload.
        *   Forwards other messages from the client to the `graphql-ws` instance for protocol handling (subscribe, complete, etc.).
    *   **Authentication Nuances**: 
        *   Overrides `handleHandshakeUpgrade` to immediately establish the WebSocket connection with null accountability, relying on the subsequent `connection_init` message and `setTokenExpireTimer` for handshake mode authentication enforcement.
        *   The overridden `setTokenExpireTimer` primarily enforces the auth timeout for `'handshake'` mode (expecting `connection_init`); token expiration for `'strict'` mode is largely handled by the base controller logic or results in operational failures if the token becomes invalid.
