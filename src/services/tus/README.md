# TUS Resumable File Upload Service Documentation

This document provides an overview of the TUS (resumable file upload protocol) service integration within this project, located in `src/services/tus/`. TUS is an open protocol for resilient and resumable file uploads, which is particularly useful for large files or unstable network conditions.

## Role of TUS in the Application

This TUS service enables clients to upload files to the server in a resumable manner. If an upload is interrupted (e.g., due to network issues), the client can resume it from where it left off without having to start over. This significantly improves the user experience for file uploads.

Key benefits and features provided by this integration likely include:

*   **Resumable Uploads:** The core feature of TUS.
*   **Handling Large Files:** Efficiently manages large file uploads by breaking them into smaller chunks.
*   **Client-Agnostic:** Works with any HTTP client that supports the TUS protocol.
*   **Extensible Storage:** Through custom data stores, it can integrate with various backend storage systems (e.g., local file system, cloud storage, database-backed storage).

## System Architecture

The TUS service is structured around the following key components:

### 1. TUS Server (`server.ts`)

*   **Purpose:** This is the heart of the TUS integration. It initializes and configures the TUS server instance (likely using a library like `tus-node-server` or a similar implementation).
*   **Key Responsibilities:**
    *   Defining the TUS protocol endpoint(s) (e.g., `/files/tus` as seen in `app.ts`).
    *   Configuring the path for uploads.
    *   Integrating the custom `DataStore` (`data-store.ts`) for managing upload metadata and file storage.
    *   Integrating the custom `Locker` (`lockers.ts`) for concurrency control.
    *   Setting up event handlers for various stages of the upload process (e.g., `EVENT_UPLOAD_CREATED`, `EVENT_UPLOAD_COMPLETE`). These handlers are crucial for performing actions like updating your database with file metadata, triggering post-processing tasks, or implementing custom validation logic.
    *   Configuring other TUS server options like maximum file size, expiration of unfinished uploads, etc.

### 2. Custom Data Store (`data-store.ts`)

*   **Purpose:** Implements the storage backend logic required by the TUS server. The TUS protocol defines a set of operations a data store must support (e.g., creating an upload, writing chunks, getting upload information, terminating an upload).
*   **Functionality:**
    *   This custom implementation likely interfaces with your application's primary storage system (e.g., saving files to a specific directory, integrating with a cloud storage service like S3, or even storing metadata in a database and file chunks in a designated location).
    *   It handles the creation of upload records, appending received chunks to the correct upload, and finalizing the file once all chunks are received.
    *   It manages metadata associated with each upload (e.g., file size, offset, creation date, custom metadata provided by the client).

### 3. Locking Mechanism (`lockers.ts`)

*   **Purpose:** Provides a locking mechanism to ensure data consistency and prevent race conditions when multiple requests might try to access or modify the same upload simultaneously. The TUS protocol often requires exclusive access to an upload resource during operations like patching (appending chunks).
*   **Functionality:**
    *   This module likely implements a distributed locking strategy if the application can run in a multi-instance environment. This could be based on Redis (using a library or custom implementation similar to `src/redis/utils/distributed-lock.ts`) or another shared resource.
    *   It provides `lock(resourceId)` and `unlock(resourceId)` (or similar) methods that the TUS server or `DataStore` can use.

### 4. Main Export (`index.ts`)

*   **Purpose:** Serves as the main entry point for the TUS service module. It typically exports the configured TUS server instance or related functions that `app.ts` uses to integrate the TUS endpoint into the main Express application.

### 5. Utilities (`utils/` directory)

*   **`wait-timeout.ts`**: A utility function likely used within the TUS service (perhaps in the locker or data store) to handle operations that require waiting with a timeout, preventing indefinite blocking.

## Workflow (Simplified)

1.  **Client Initiates Upload (Creation):**
    *   The client sends a `POST` request to the TUS endpoint (e.g., `/files/tus`) with headers indicating the total file size (`Upload-Length`) and any initial metadata (`Upload-Metadata`).
    *   The TUS server, via `data-store.ts`, creates a new unique upload resource and returns its URL (e.g., `/files/tus/<upload_id>`) to the client in the `Location` header.
2.  **Client Uploads Chunks (Patching):**
    *   The client sends one or more `PATCH` requests to the specific upload URL. Each `PATCH` request includes:
        *   `Upload-Offset`: The byte offset from which to start writing.
        *   `Content-Type: application/offset+octet-stream`.
        *   The file chunk data in the request body.
    *   The TUS server, using `data-store.ts` and protected by `lockers.ts`, appends the received chunk to the stored file at the correct offset.
    *   The server responds with the new `Upload-Offset`.
3.  **Resuming an Upload:**
    *   If an upload is interrupted, the client can send a `HEAD` request to the upload URL to get the current `Upload-Offset` and then resume sending `PATCH` requests from that offset.
4.  **Upload Completion:**
    *   Once the final chunk is uploaded and the `Upload-Offset` matches the `Upload-Length`, the upload is considered complete.
    *   The TUS server (often via an `EVENT_UPLOAD_COMPLETE` event handler defined in `server.ts`) can then trigger actions like moving the completed file to permanent storage, updating database records, etc.

## Configuration

*   **TUS Server Options (`server.ts`):**
    *   `path`: The base URL path for the TUS endpoint.
    *   `datastore`: The custom `DataStore` instance.
    *   `locker`: The custom `Locker` instance.
    *   Event handlers for `EVENT_UPLOAD_CREATED`, `EVENT_UPLOAD_COMPLETE`, etc.
    *   `namingFunction`: How upload IDs are generated.
    *   `respectForwardedHeaders`: If running behind a proxy.
*   **Data Store Configuration (`data-store.ts`):**
    *   Storage paths or connection details for the backend storage system.
*   **Locker Configuration (`lockers.ts`):**
    *   Connection details if using an external service like Redis for locks.
*   **Environment Variables:** Many of these configurations might be driven by environment variables (e.g., storage paths, Redis URL for locking).

## Integration with Application (`app.ts`)

The TUS service is typically integrated into the main application in `src/app.ts` by:

1.  Importing the configured TUS server (often the Express router/handler exported from `src/services/tus/index.ts` or `src/services/tus/server.ts`).
2.  Mounting it on a specific path:
    ```typescript
    // In app.ts
    import tusRouter from './services/tus/index.js'; // Or directly from server.ts
    // ...
    if (env['TUS_ENABLED'] === true) {
      app.use('/files/tus', tusRouter);
    }
    ```

This TUS service provides a robust and standardized way to handle file uploads in your application. 