# YP Storage Module (`src/storage`)

This module provides a flexible and extensible system for managing file storage within the YP application. It allows for multiple storage locations, each potentially using a different storage driver (e.g., local filesystem, S3, Google Cloud Storage, Azure Blob Storage).

## Overview

The storage module is initialized via `src/storage/index.ts`, which sets up a singleton instance of the `StorageManager`. This manager is responsible for:

1.  **Driver Registration:** Dynamically loading and registering available storage drivers based on environment variable configuration.
2.  **Location Registration:** Configuring specific storage "locations" (e.g., 'uploads', 'assets'), associating them with a chosen driver and specific options (like bucket names, paths, credentials), also based on environment variables.
3.  **Providing Access:** Offering a unified API to interact with different storage locations and their underlying drivers.

## Core Mechanism

The core functionality revolves around a few key files:

*   **`index.ts`**:
    *   Exports a `getStorage()` function that returns a singleton instance of the `StorageManager`.
    *   Validates the `STORAGE_LOCATIONS` environment variable.
    *   Orchestrates the registration of drivers (via `registerDrivers`) and locations (via `registerLocations`).
*   **`register-drivers.ts`**:
    *   Identifies which storage drivers are actively used by inspecting `STORAGE_<LOCATION_NAME>_DRIVER` environment variables for all configured locations.
    *   Uses `getStorageDriver` to dynamically import the appropriate driver class.
    *   Registers each unique, actively used driver with the `StorageManager`.
*   **`register-locations.ts`**:
    *   Reads the `STORAGE_LOCATIONS` environment variable (a comma-separated list of location names).
    *   For each location name (e.g., `UPLOADS`, `ASSETS`):
        *   It retrieves the specific driver type for that location from `STORAGE_<LOCATION_NAME>_DRIVER`.
        *   It gathers all other `STORAGE_<LOCATION_NAME>_*` environment variables to build an options object for that location (e.g., `STORAGE_UPLOADS_BUCKET`, `STORAGE_UPLOADS_PATH_PREFIX`).
        *   It registers the location with the `StorageManager`, associating the location name with its configured driver and options.
*   **`get-storage-driver.ts`**:
    *   Acts as a dynamic importer for storage driver implementations.
    *   It maintains an alias map for standard drivers (e.g., 'local', 's3', 'gcs', 'azure').
    *   Based on the driver alias, it dynamically imports the corresponding driver package (e.g., `./storage-driver-local`, `./storage-driver-s3`). It expects the driver package to export its main driver class as the default export.

## Storage Manager (`storage-manager/index.ts`)

The `StorageManager` class is the central hub for all storage operations.

*   **`registerDriver(name: string, DriverClass: any)`**: Allows new storage driver classes to be registered with a unique name.
*   **`registerLocation(name: string, driver: string, options: Record<string, any>)`**: Configures a new storage location, specifying its name, the registered driver it should use, and driver-specific options.
*   **`location(name: string): Driver`**: Retrieves an initialized driver instance for the specified location. This is the primary method used by the application to access a storage location. If the location is not found or the driver is not registered, it will throw an error.

### Driver Interface

All storage drivers are expected to implement a common `Driver` interface (and optionally `TusDriver` for TUS resumable upload support). This ensures a consistent API for file operations across different storage backends. Key methods include:

*   `read(filePath: string, options?: any): Promise<ReadableStream | Buffer>`
*   `write(filePath: string, data: ReadableStream | Buffer | string, options?: any): Promise<any>`
*   `delete(filePath: string, options?: any): Promise<boolean>`
*   `exists(filePath: string, options?: any): Promise<boolean>`
*   `stat(filePath: string, options?: any): Promise<any>` (returns metadata like size, last modified)
*   `list(folderPath?: string, options?: any): Promise<Array<{ key: string; size?: number; lastModified?: Date; [key: string]: any }>>`

For TUS support, drivers implement methods like:
*   `createUpload(filePath: string, uploadLength: number, metadata?: any)`
*   `writeChunk(filePath: string, chunk: ReadableStream | Buffer, offset: number, length: number)`
*   `getUpload(filePath: string)`
*   `deleteUpload(filePath: string)`

## Configuration (via Environment Variables)

The entire storage system is configured through environment variables.

1.  **`STORAGE_LOCATIONS`**: A comma-separated string defining the names of all active storage locations (e.g., `UPLOADS,ASSETS,CACHE`).
2.  For each `<LOCATION_NAME>` listed in `STORAGE_LOCATIONS`:
    *   **`STORAGE_<LOCATION_NAME>_DRIVER`**: Specifies the driver type for this location (e.g., `local`, `s3`, `gcs`, `azure`).
    *   **`STORAGE_<LOCATION_NAME>_...`**: Additional driver-specific options. For example:
        *   For `local`: `STORAGE_<LOCATION_NAME>_ROOT` (the root directory on the filesystem).
        *   For `s3`: `STORAGE_<LOCATION_NAME>_KEY`, `STORAGE_<LOCATION_NAME>_SECRET`, `STORAGE_<LOCATION_NAME>_BUCKET`, `STORAGE_<LOCATION_NAME>_REGION`, `STORAGE_<LOCATION_NAME>_ENDPOINT`.
        *   Similar patterns apply for `gcs` and `azure`.

## Available Drivers

The module is structured to support various storage drivers. Each driver resides in its own subdirectory (e.g., `storage-driver-local/`, `storage-driver-s3/`).

### Local Filesystem Driver (`storage-driver-local`)

*   **Source:** `src/storage/storage-driver-local/index.ts`
*   **Alias:** `local`
*   **Interface:** Implements `TusDriver`.

This driver stores files on the local filesystem of the server.

**Configuration Options (via environment variables for a location):**

*   `STORAGE_<LOCATION_NAME>_ROOT`: (Required) The absolute or relative path to the root directory on the server where files for this location will be stored. If relative, it's resolved against the application's working directory.

**Key Functionality:**

*   All standard driver operations (`read`, `write`, `delete`, `stat`, `exists`, `list`, `move`, `copy`) are implemented using Node.js `fs` and `fs/promises` modules.
*   Paths are resolved relative to the configured `root` directory.
*   Directories are created recursively as needed (`ensureDir`).
*   `read` supports byte range requests.
*   `list` recursively finds all files under a given prefix (or the root if no prefix).

**TUS Support:**

*   Supports `'creation'`, `'termination'`, and `'expiration'` extensions.
*   `createChunkedUpload`: Creates an empty file to mark the start of an upload.
*   `writeChunk`: Writes the provided data stream to the file at the specified byte offset.
*   `deleteChunkedUpload`: Deletes the target file.
*   `finishChunkedUpload`: Is a no-operation as data is written directly to the final file location with each chunk.

### Amazon S3 Driver (`storage-drive-s3`)

*   **Source:** `src/storage/storage-drive-s3/index.ts`
*   **Alias:** `s3`
*   **Interface:** Implements `TusDriver`.

This driver interfaces with Amazon S3 or S3-compatible services for object storage.

**Dependencies:**

*   `@aws-sdk/client-s3`
*   `@aws-sdk/lib-storage` (for managed uploads)
*   `@shopify/semaphore` (for TUS part upload concurrency)
*   `@tus/utils`

**Configuration Options (via environment variables for a location):**

*   `STORAGE_<LOCATION_NAME>_KEY`: AWS Access Key ID.
*   `STORAGE_<LOCATION_NAME>_SECRET`: AWS Secret Access Key.
*   `STORAGE_<LOCATION_NAME>_BUCKET`: (Required) S3 Bucket name.
*   `STORAGE_<LOCATION_NAME>_ROOT`: Optional root path/prefix within the bucket (e.g., `uploads/images`). Defaults to no prefix.
*   `STORAGE_<LOCATION_NAME>_ACL`: Optional S3 Canned ACL (e.g., `private`, `public-read`).
*   `STORAGE_<LOCATION_NAME>_SERVER_SIDE_ENCRYPTION`: Optional server-side encryption algorithm (e.g., `AES256`, `aws:kms`).
*   `STORAGE_<LOCATION_NAME>_ENDPOINT`: Optional custom S3 endpoint URL (for S3-compatible services like MinIO).
*   `STORAGE_<LOCATION_NAME>_REGION`: AWS Region (e.g., `us-east-1`).
*   `STORAGE_<LOCATION_NAME>_FORCE_PATH_STYLE`: Set to `true` to force path-style addressing (useful for some S3-compatible services).
*   `STORAGE_<LOCATION_NAME>_TUS_CHUNK_SIZE`: Preferred part size in bytes for TUS uploads (e.g., `8388608` for 8MiB). Defaults to 5MiB. S3 multipart upload limits apply (min 5MiB, max 10,000 parts).

**Key Functionality:**

*   Utilizes `S3Client` from `@aws-sdk/client-s3` with optimized HTTP agent settings for performance.
*   `write` operations use the managed `Upload` class from `@aws-sdk/lib-storage` for robust, streaming multipart uploads for larger files.
*   Supports standard driver operations by mapping them to S3 commands (e.g., `GetObjectCommand`, `HeadObjectCommand`, `CopyObjectCommand`, `DeleteObjectCommand`, `ListObjectsV2Command`).
*   `move` is implemented as a copy followed by a delete.

**TUS Support:**

*   Provides robust TUS resumable upload support by leveraging S3's multipart upload mechanism.
*   **State Management:** When a TUS upload is initiated, an S3 multipart upload is created. The `UploadId` and other metadata (original filename, total size, S3 key, completed part ETags) are stored in a temporary JSON file (e.g., `<filename>.tus.json`) in the server's temporary directory (e.g., `os.tmpdir()`). This file enables resumability across server restarts or interruptions.
*   `tusExtensions`: Reports support for `creation`, `creation-with-upload`, `termination`, `checksum`, `expiration`, and `tus-resumable`.
*   `createChunkedUpload`: Initiates an S3 multipart upload via `CreateMultipartUploadCommand` and creates the local `.tus.json` state file.
*   `writeChunk`: Uploads data as individual parts using `UploadPartCommand`. Uses a semaphore to control concurrent part uploads. Part ETags and numbers are recorded in the `.tus.json` file upon successful upload of each part.
*   `finishChunkedUpload`: Finalizes the S3 multipart upload using `CompleteMultipartUploadCommand` with the list of parts from the `.tus.json` file. The temporary state file is then deleted.
*   `deleteChunkedUpload`: Aborts the S3 multipart upload using `AbortMultipartUploadCommand` (if an `UploadId` exists in the state file) and removes the temporary state file. It will also attempt to delete the object from S3.

### Microsoft Azure Blob Storage Driver (`storage-driver-azure`)

*   **Source:** `src/storage/storage-driver-azure/index.ts`
*   **Alias:** `azure`
*   **Interface:** Implements `Driver` (does **not** currently support TUS).

This driver interacts with Microsoft Azure Blob Storage.

**Dependencies:**

*   `@azure/storage-blob`

**Configuration Options (via environment variables for a location):**

*   `STORAGE_<LOCATION_NAME>_CONTAINER_NAME`: (Required) The name of the Azure Blob Storage container.
*   `STORAGE_<LOCATION_NAME>_ACCOUNT_NAME`: (Required) Azure Storage account name.
*   `STORAGE_<LOCATION_NAME>_ACCOUNT_KEY`: (Required) Azure Storage account key (primary or secondary).
*   `STORAGE_<LOCATION_NAME>_ROOT`: Optional root path/prefix within the container (e.g., `user_files/documents`). Defaults to no prefix.
*   `STORAGE_<LOCATION_NAME>_ENDPOINT`: Optional custom service endpoint URL. Defaults to `https://<ACCOUNT_NAME>.blob.core.windows.net`.

**Key Functionality:**

*   Utilizes `BlobServiceClient` and `ContainerClient` from `@azure/storage-blob`.
*   Authentication is handled via `StorageSharedKeyCredential`.
*   All standard `Driver` operations are implemented:
    *   `read`: Uses `blobClient.download()` and supports byte ranges.
    *   `write`: Uses `blockBlobClient.uploadStream()`, allows specifying `blobContentType`.
    *   `delete`: Uses `blockBlobClient.deleteIfExists()`.
    *   `stat`: Uses `blobClient.getProperties()` for size and modification date.
    *   `exists`: Uses `blockBlobClient.exists()`.
    *   `copy`: Uses `targetBlobClient.beginCopyFromURL()`.
    *   `move`: Implemented as a copy followed by a delete.
    *   `list`: Uses `containerClient.listBlobsFlat()`.

**TUS Support:**

*   This driver does **not** currently implement the `TusDriver` interface and therefore does not support TUS resumable uploads.

### Google Cloud Storage (GCS) Driver (`storage-driver-gcs`)

*   **Source:** `src/storage/storage-driver-gcs/index.ts`
*   **Alias:** `gcs`
*   **Interface:** Implements `Driver` (does **not** currently support TUS).

This driver is used to interact with Google Cloud Storage buckets.

**Dependencies:**

*   `@google-cloud/storage`

**Configuration Options (via environment variables for a location):**

*   `STORAGE_<LOCATION_NAME>_BUCKET`: (Required) The name of the GCS bucket.
*   `STORAGE_<LOCATION_NAME>_ROOT`: Optional root path/prefix within the bucket (e.g., `data/archive`). Defaults to no prefix.
*   `STORAGE_<LOCATION_NAME>_API_ENDPOINT`: Optional custom GCS API endpoint (e.g., for emulators or specific regional endpoints).
*   **Authentication:** Typically handled via Google Cloud SDK default mechanisms, such as the `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing to a service account key file, or default credentials when running on GCP infrastructure. The `PROJECT_ID` can also be set via `GCLOUD_PROJECT` or an explicit `STORAGE_<LOCATION_NAME>_PROJECT_ID` variable if needed by the `@google-cloud/storage` library, though often inferred.

**Key Functionality:**

*   Utilizes the `Storage` class from `@google-cloud/storage` to interact with GCS.
*   All standard `Driver` operations are implemented:
    *   `read`: Uses `file.createReadStream()` and supports byte ranges.
    *   `write`: Uses `file.createWriteStream({ resumable: false })` for direct streaming. GCS native resumable uploads are disabled for this basic write.
    *   `delete`: Uses `file.delete()`.
    *   `stat`: Uses `file.getMetadata()` for size and modification date.
    *   `exists`: Uses `file.exists()`.
    *   `copy`: Uses `file.copy()`.
    *   `move`: Uses `file.move()`.
    *   `list`: Uses `bucket.getFiles()` with manual pagination to list objects.

**TUS Support:**

*   This driver does **not** currently implement the `TusDriver` interface and therefore does not support TUS resumable uploads.
