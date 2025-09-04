# File Processing Utilities Documentation

This document provides an overview of the file processing utilities located in `src/services/files/`. Unlike other directories in `src/services/` which might contain full service classes for managing specific data collections, this directory primarily houses utility functions for handling and extracting information from files, particularly images.

These utilities are likely consumed by other services responsible for file uploads, storage management, or data services that link to file records (e.g., a TUS service or an `ItemsService` for a `yp_files` collection).

## Core Functionalities

*   **Image Metadata Extraction:** Provides tools to read image files and extract rich metadata, including dimensions, EXIF, IPTC, XMP, and ICC profiles.
*   **Configured Image Processing:** Offers a centrally configured instance of the `sharp` library for consistent image manipulation and analysis.

## Key Components

### 1. Metadata Extraction (`lib/extract-metadata.ts` and `utils/get-metadata.ts`)

*   **`extractMetadata(storageLocation, data)` (`lib/extract-metadata.ts`):**
    *   **Purpose:** Orchestrates the extraction of metadata from a file already stored.
    *   **Process:**
        1.  Takes a `storageLocation` and `data` (object containing at least `type` and `filename_disk`).
        2.  Retrieves the storage adapter.
        3.  If the file type is a supported image format (defined in `SUPPORTED_IMAGE_METADATA_FORMATS`), it reads the file stream from storage.
        4.  Calls `getMetadata()` (from `utils/get-metadata.ts`) with the stream to perform the actual extraction.
        5.  Populates a `fileMeta` object with extracted `height`, `width`, `description`, `title`, `tags`, and raw `metadata`, but only if these fields are not already present in the input `data` (useful for replace operations).
    *   **Output:** Returns an object (`Metadata`) containing the extracted metadata fields.

*   **`getMetadata(stream, allowList)` (`utils/get-metadata.ts`):**
    *   **Purpose:** Extracts detailed metadata from an image file stream using `sharp` and other parsing libraries.
    *   **Process:**
        1.  Takes a `Readable` stream and an optional `allowList` for raw metadata fields (defaults to `env['FILE_METADATA_ALLOW_LIST']`).
        2.  Uses a configured `sharp` instance (`getSharpInstance()`) to process the stream.
        3.  Retrieves basic metadata from `sharp` (width, height, orientation, EXIF, ICC, IPTC, XMP buffers).
        4.  Adjusts width/height based on orientation if necessary.
        5.  Parses detailed metadata:
            *   **EXIF:** Uses `exif-reader` to parse `sharpMetadata.exif`.
            *   **ICC:** Uses `icc.parse()` to parse `sharpMetadata.icc`.
            *   **IPTC:** Uses `parseIptc()` (from `utils/parse-image-metadata.ts`) to parse `sharpMetadata.iptc`.
            *   **XMP:** Uses `parseXmp()` (from `utils/parse-image-metadata.ts`) to parse `sharpMetadata.xmp`.
        6.  Extracts common fields like `description` (from IPTC Caption), `title` (from IPTC Headline), and `tags` (from IPTC Keywords).
        7.  Constructs a `fullMetadata` object containing all parsed sections (ifd0, exif, gps, icc, iptc, xmp, etc.).
        8.  Filters `fullMetadata` based on the `allowList` before assigning to `metadata.metadata`.
        9.  Trims string values within the collected metadata.
    *   **Output:** Returns a promise that resolves to a `Metadata` object.

### 2. Image Metadata Parsers (`utils/parse-image-metadata.ts`)

*   **`parseIptc(buffer: Buffer)`:**
    *   **Purpose:** Parses IPTC (International Press Telecommunications Council) metadata from a buffer.
    *   **Process:** Iterates through IPTC blocks in the buffer, identifies known entry types (caption, credit, keywords, etc.), and extracts their string values.
    *   **Output:** Returns an object mapping IPTC field names to their values.
*   **`parseXmp(buffer: Buffer)`:**
    *   **Purpose:** Parses XMP (Extensible Metadata Platform) data from a buffer, focusing on Dublin Core (`dc:`) elements.
    *   **Process:** Uses regular expressions to find and extract values for `dc:title`, `dc:description`, `dc:rights`, `dc:creator`, and `dc:subject`. Handles simple string values and RDF bags (for lists like keywords).
    *   **Output:** Returns an object mapping XMP field names (e.g., 'title', 'subject') to their values.

### 3. Sharp Instance Configuration (`lib/get-sharp-instance.ts`)

*   **`getSharpInstance(): Sharp`:**
    *   **Purpose:** Provides a pre-configured instance of the `sharp` image processing library.
    *   **Configuration (from environment variables):**
        *   `limitInputPixels`: Calculated from `env['ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION']` to prevent processing overly large images.
        *   `sequentialRead`: Set to `true` (likely for performance or memory reasons).
        *   `failOn`: Sets the sensitivity level for invalid image detection, based on `env['ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL']`.
    *   **Output:** Returns a `sharp` instance.

## Usage Context

These utilities would typically be used in the following scenarios:

*   **After File Upload:** When a new file (especially an image) is uploaded, these tools can be used to extract its metadata. This metadata can then be stored alongside the file record in a database (e.g., in a `yp_files` collection).
*   **File Information Retrieval:** When information about an existing file is needed, these utilities can re-process the file if its metadata wasn't originally stored or needs to be updated.
*   **Image Processing Pipelines:** The configured `sharp` instance can be a starting point for more complex image transformations (resizing, cropping, format conversion) elsewhere in the application.

## Environment Variables

Several environment variables influence the behavior of these utilities:

*   `ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION`: Affects the `limitInputPixels` for `sharp`.
*   `ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL`: Configures how `sharp` handles potentially invalid images.
*   `FILE_METADATA_ALLOW_LIST`: A comma-separated string or `*` specifying which raw metadata fields (e.g., from EXIF, IPTC) should be stored. Governs the content of the `metadata.metadata` field. 