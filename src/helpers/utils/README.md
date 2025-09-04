# Helper Utilities (`src/helpers/utils`)

This directory contains a collection of diverse helper functions and utilities that provide common, reusable logic across various parts of the application. They range from data parsing and validation to query construction, image processing, security, and schema manipulation.

## Overview

The utilities in this directory are designed to encapsulate specific pieces of functionality, promoting code reuse and separation of concerns. They assist in handling complex tasks such_as:

-   **Querying**: Parsing, sanitizing, validating, and applying database queries.
-   **Data Validation**: Validating incoming request payloads and query parameters.
-   **Data Transformation & Manipulation**: Modifying data structures, transforming image assets, and redacting sensitive information.
-   **Access Control & Permissions**: Merging permission sets, reducing schemas based on access rights, and managing shared item access.
-   **Security & Authentication**: Handling JWTs, IP address checks, and session verification.
-   **String & Object Utilities**: Common operations on strings, objects, and arrays.
-   **Schema & Data Management**: Working with application schema definitions and system data.
-   **Asynchronous Operations**: Utilities for handling asynchronous tasks and caching.
-   **Node.js Specific Helpers**: Utilities that leverage Node.js specific functionalities.

## Key Utilities and Their Roles

Below is a breakdown of some ofjs the most critical utilities and their functionalities.

### Query Pipeline & Data Retrieval

A significant portion of these helpers revolves around constructing, sanitizing, validating, and executing database queries, primarily using Knex.js. This pipeline is crucial for handling API requests that involve data fetching with various parameters.

**Key Query Parameters Handled:**

*   **`filter`**: Defines conditions for selecting data.
    *   **Structure**: A nested object where keys are field names and values specify the operator and comparison value.
    *   **Targeting Fields**: Field names can be direct fields of the queried collection or use **dot-notation** (e.g., `relational_field.nested_field.target_field`) to target fields in related collections. Functions can also be applied (e.g., `year(date_created)`).
    *   **Logical Operators**:
        *   `_and: [{...}, {...}]`: All nested filter objects must be true.
        *   `_or: [{...}, {...}]`: At least one nested filter object must be true.
        *   `_not: {...}`: The nested filter object must be false.
    *   **Common Filter Operators** (applied to field values):
        *   `_eq: value`: Equals.
        *   `_neq: value`: Not equals.
        *   `_gt: value`: Greater than.
        *   `_gte: value`: Greater than or equal to.
        *   `_lt: value`: Less than.
        *   `_lte: value`: Less than or equal to.
        *   `_in: [value1, value2]`: Value is one of the specified values.
        *   `_nin: [value1, value2]`: Value is not one of the specified values.
        *   `_contains: "substring"`: String contains the substring (often case-sensitive).
        *   `_ncontains: "substring"`: String does not contain the substring.
        *   `_starts_with: "prefix"`: String starts with the prefix.
        *   `_nstarts_with: "prefix"`: String does not start with the prefix.
        *   `_ends_with: "suffix"`: String ends with the suffix.
        *   `_nends_with: "suffix"`: String does not end with the suffix.
        *   `_null: true | false`: Field is null or is not null.
        *   `_empty: true | false`: Field is an empty string/collection or is not.
        *   `_nempty: true | false`: Field is not an empty string/collection or is.
        *   (Note: Specific JSON or array operators like `_json_contains` or `_length_eq` might be available depending on field types and backend implementation.)
    *   **Relational Filters**: When dot-notation is used, the system automatically joins related tables based on schema definitions to apply filters to fields in those related collections (see "Handling Relational Data" below).
    *   **Dynamic Variables**: Filters can use dynamic variables like `$NOW`, `$CURRENT_USER`, `$CURRENT_ROLE` which are resolved during parsing.

*   **`search`**: A string used for full-text-like search across multiple relevant fields of a collection.
    *   Typically performs a case-insensitive "contains" (e.g., `LIKE '%searchTerm%'`) operation on string or text-based fields.
    *   Usually does not support complex search syntax (e.g., field-specific search, phrase search) unless explicitly implemented.

*   **`sort`**: An array of strings specifying the order of results.
    *   Syntax: `["fieldName"]` for ascending, `["-fieldName"]` for descending.
    *   Field names can be direct or use **dot-notation** (e.g., `"relational_field.target_field"`) for sorting by related data.
    *   Multiple sort fields are supported (e.g., `["lastName", "-firstName"]`).
    *   Sorting by related fields also triggers automatic joining of tables (see "Handling Relational Data" below).

*   **`fields`**: An array of strings or objects to specify which fields to return.
    *   Example: `["name", "email"]`.
    *   **Relational Fields**: Dot-notation can be used to select specific fields from related collections (e.g., `["name", "articles.title", "articles.comments.text"]`). This allows for including targeted data from related entities directly in the response.
    *   The system automatically joins necessary tables to fetch these related fields (see "Handling Relational Data" below).
    *   Aliasing can be supported (e.g., `fields: ["name:customer_name"]`) depending on the `sanitize-query.ts` and final projection logic.

*   **`limit`**: An integer specifying the maximum number of items to return.
*   **`offset`**: An integer specifying the number of items to skip from the beginning of the result set.
*   **`page`**: An integer used with `limit` for pagination (`offset = limit * (page - 1)`).

*   **`meta`**: A parameter to request additional metadata about the query.
    *   Common usage: `meta: "*"` or `meta: "total_count,filter_count"`.
    *   The system typically performs additional queries (e.g., a `COUNT(*)` with the same filters) to provide this data. `applyQuery` itself doesn't directly return metadata but its logic is reused.

*   **`groupBy`**: An array of field names to group the results by. Used with aggregate functions.
    *   Example: `["department"]`.

*   **`aggregate`**: An object to specify aggregate functions to apply.
    *   Example: `{ sum: ["salary"], avg: ["age"], count: ["id"] }`.
    *   Supported functions often include `count`, `countDistinct`, `sum`, `sumDistinct`, `avg`, `avgDistinct`, `min`, `max`.
    *   Results are typically grouped by fields specified in `groupBy` or by all non-aggregated selected fields.

*   **`deep`**: An object structure specifying how to fetch nested relational data.
    *   Example: `{ articles: { _fields: ["title"], comments: { _fields: ["text", "author.name"] } } }`.
    *   This is usually handled by a layer above `applyQuery`, which might make multiple calls to `applyQuery` or a similar mechanism to fetch related data recursively or in batches.

*   **`alias`**: While `applyQuery` uses internal table aliases for joins, the `alias` query parameter (if supported as per `sanitize-query.ts`) generally refers to aliasing field names in the output (see `fields` parameter).

**Handling Relational Data (via dot-notation):**

Many query parameters, notably `filter`, `fields`, and `sort`, support a powerful dot-notation syntax (e.g., `relational_field.nested_field.column_name`) to interact with data in related collections. This mechanism works as follows:

1.  **Path Recognition**: The system parses these dot-separated paths.
2.  **Schema Lookup**: It consults the application's schema, which defines collections, their fields, and the relationships (foreign keys, junction tables) between them.
3.  **Automatic JOIN Generation**: Based on the schema and the requested path, `apply-query.ts` (with critical assistance from `getRelationInfo.ts` to understand relationship details and `getColumnPath.ts` to resolve the full path including necessary table aliases) dynamically constructs the required SQL `JOIN` clauses (typically `LEFT JOIN`). This links the primary collection being queried with the related collections mentioned in the path.
4.  **Targeted Operation**: Once tables are joined:
    *   For `filter`, the condition is applied to the specified column in the joined related table.
    *   For `fields`, the specified column from the joined related table is included in the `SELECT` statement.
    *   For `sort`, the `ORDER BY` clause is applied to the specified column in the joined related table.

This allows for precise and efficient data retrieval and filtering based on related data without needing to make multiple separate API calls. It is a targeted way to access specific related data points, distinct from the `deep` parameter which is designed for fetching more comprehensive, predefined nested structures of related items.

**Core Processing Steps:**

1.  **`parse-filter.ts`** (Primarily for the `filter` parameter):
    *   Parses complex filter objects provided in API queries.
    *   Handles dynamic variables within filters (e.g., `$NOW`, `$CURRENT_USER`, `$CURRENT_ROLE`).
    *   Restructures logical operators (`_and`, `_or`, `_not`) into a standardized format for further processing.
    *   Parses and prepares field functions within filters (e.g., `year(date_created)` via `parse-filter-key.ts`).

2.  **`sanitize-query.ts`** (For all query parameters):
    *   Takes a raw query object from an API request and sanitizes its various parameters (`limit`, `fields`, `groupBy`, `aggregate`, `sort`, `filter`, `offset`, `page`, `meta`, `search`, `deep`, `alias`, etc.).
    *   Converts different input formats (e.g., comma-separated strings, JSON strings) into a consistent internal `Query` object.
    *   Applies default and maximum query limits based on environment variables.
    *   Crucial for ensuring query inputs are well-formed and secure before further processing.

3.  **`validate-query.ts`**:
    *   Validates the sanitized `Query` object against a Joi schema and custom logical rules.
    *   Checks for structural correctness, valid operator usage, and data types.
    *   Enforces system limits, most notably the `MAX_RELATIONAL_DEPTH` for fields, sorts, filters, and deep queries to prevent overly complex or abusive queries.
    *   Uses `calculate-field-depth.ts` to determine nesting levels in filter/deep objects.

4.  **`apply-query.ts`**:
    *   The engine that translates the sanitized and validated `Query` object into an executable Knex.js query builder instance.
    *   Dynamically constructs SQL queries, including:
        *   `SELECT` clauses based on `fields` and `aggregate` parameters (though `fields` for final projection might be handled separately, `aggregate` is directly used).
        *   `WHERE` clauses from the `filter` object, handling complex nested conditions, relational filters, and various filter operators.
        *   `JOIN` clauses (primarily `LEFT JOIN`) for filtering and sorting on related data, managing table aliases (generated by `generateAlias`) to prevent conflicts. This is guided by `getColumnPath.ts` and `getRelationInfo.ts`.
        *   `ORDER BY` clauses from `sort` parameters.
        *   `GROUP BY` clauses.
        *   `LIMIT` and `OFFSET` clauses.
        *   Full-text search conditions via `search` parameter (typically `LIKE` clauses).
    *   Relies on helper functions like `getColumnPath.ts` and `getColumn.ts` to resolve field paths to database columns, considering joins and aliases.

5.  **`merge-filters.ts`**:
    *   Combines two filter objects (`filterA`, `filterB`) into a new filter using a specified logical strategy ('and' or 'or', defaulting to 'and').
    *   If one filter is null, returns the other. If both are present, creates a new filter like `{ "_and": [filterA, filterB] }`.
    *   Fundamental for dynamically building complex query filters.

**Interaction Flow (Query Pipeline):**
`User Input -> parse-filter.ts (for filter part) -> sanitize-query.ts -> validate-query.ts -> apply-query.ts -> Knex.js -> Database`

### Data Validation

-   **`validate-payload.ts`**:
    *   Validates incoming data payloads (e.g., from POST/PUT requests) against a set of rules defined in a filter-like object structure.
    *   Dynamically generates Joi schemas from these rules using `generate-joi.ts`.
    *   Supports logical `_and` / `_or` combinations of validation rule sets.
    *   Allows for pre-processing of the payload via `inject-function-results.ts` before validation.

### Access Control, Permissions & Sharing

-   **`reduce-schema.ts`**:
    *   Filters the global application `SchemaOverview` based on a user's permissions and specified actions (e.g., 'read', 'create').
    *   Produces a "reduced" schema containing only the collections, fields, and relations the user is authorized to access.
    *   Essential for security and ensuring downstream code only sees permissible parts of the data model.

-   **`merge-permissions.ts`**:
    *   Provides functions to combine multiple permission objects or arrays of permission objects.
    *   Supports 'and' or 'or' strategies for merging `permissions` (filter objects), `validation` (filter objects), and `fields` (field lists).
    *   Groups permissions by `collection__action__role` for effective aggregation.

-   **`merge-permissions-for-share.ts`**:
    *   A specialized utility for augmenting a user's permissions when an item is shared with them.
    *   Generates 'read' permissions for the shared item and recursively for related data that is contextually relevant.
    *   Uses a `traverse` function to walk the (permission-reduced) schema and create appropriate filter-based permissions.
    *   Combines generated share permissions with existing user permissions to define the final access scope for the shared context.

### Security & Authentication

-   **`is-url-allowed.ts`**: Checks if a given URL is present in an allow-list, either by exact match or by matching the combination of origin (protocol + domain + port) and pathname. Useful for validating redirect targets or other external URLs.
-   **`jwt.ts`**:
    *   `verifyJWT`: Verifies a generic JWT's signature, expiry, and issuer (expected 'yourpartner'). Throws custom errors like `TokenExpiredError` or `InvalidTokenError`.
    *   `verifyAccessJWT`: Extends `verifyJWT` for access tokens, additionally checking for the presence of `role`, `app_access`, and `admin_access` claims in the payload.

-   **`is-yourpartner-jwt.ts`**:
    *   Quickly checks if a string appears to be a JWT and if its decoded payload has `iss: 'yourpartner'`. Does *not* verify the signature; used for preliminary checks.

-   **`verify-session-jwt.ts`**:
    *   Given a decoded JWT payload, this function verifies that the associated session (identified by `payload.session`, `payload.id`, `payload.share`) is still active and valid in the `yp_sessions` database table.
    *   Crucial for server-side session validation and revocation.

-   **`redact-object.ts`**:
    *   Redacts sensitive information from objects before logging or transmitting them.
    *   Supports redaction based on:
        *   Specific string values (e.g., replacing all occurrences of a known credit card number).
        *   Key paths, with wildcard support (`*` for shallow, `**` for deep matching) to target fields for redaction.
    *   Uses a customizable replacement function.

-   **`ip-in-networks.ts`**:
    *   Checks if a given IP address falls within a list of specified networks (single IPs, CIDR ranges, IP ranges). Uses the `ip-matching` library.
    *   Useful for IP-based allow/deny lists.
    *   (Related IP helpers like `is-denied-ip.ts` and `agent-with-ip-validation.ts` are found in `src/helpers/request/`)

### Image Transformations

-   **`transformations.ts`**:
    *   Prepares image processing pipelines, likely for a library like Sharp.
    *   `resolvePreset`: Takes transformation parameters (width, height, format, quality, fit, focal point) and file metadata to generate an array of transformation steps (e.g., `['resize', ...]`, `['extract', ...]`, `['toFormat', ...]`).
    *   Includes sophisticated logic for focal point cropping, ensuring the subject of an image remains centered after resizing and aspect ratio changes.
    *   `getFormat`: Determines the optimal output format based on input parameters, original file type, and `Accept` headers.

### Other Notable Utilities

-   **Data Parsing & Validation**:
    *   `parse-filter-function-path.ts`: Transforms a function call within a filter path string (e.g., `a.b.func(c.d)`) to ensure the function is applied to the last segment (e.g., `a.b.c.func(d)`). Used for standardizing function path representations in queries.
    *   `parse-filter-key.ts`: Parses a filter key string (e.g., `year(date_created)` or `title`) to separate the field name (`date_created`, `title`) from an optional function name (`year`, `undefined`).
    *   `parse-json.ts`: Safely parses JSON strings, specifically preventing prototype pollution attacks by stripping `__proto__` properties during parsing if detected in the input string.
    *   `parse-numeric-string.ts`: Robustly parses a string into a numeric value (number or BigInt), returning `null` if the string isn't a strict representation of a decimal number. Handles numbers outside JavaScript's safe integer range by attempting BigInt conversion and includes a round-trip string conversion check for strictness.
    *   `require-yaml.ts`: Synchronously reads and parses a YAML file into a JavaScript object using `fs-extra` and `js-yaml`.
    *   `to-array.ts`: Converts a value to an array. If the input is a string, it splits by comma. If already an array, returns it. Otherwise, wraps the value in an array.
    *   `to-boolean.ts`: Converts a value (commonly from strings like environment variables) to a boolean. Returns `true` for 'true', true, '1', or 1.
    *   `validate-keys.ts`: Validates if provided keys (typically primary keys) conform to their expected data type (e.g., UUID, integer) as defined in the schema for a given collection and key field. Throws a `ForbiddenError` on validation failure.
    *   `validate-env.ts`: Checks for the presence of required environment variables at startup, logging an error and exiting the process if any are missing.
    *   `validate-snapshot.ts`: Validates schema snapshot objects, checking for structural correctness, application version, and database vendor compatibility. Essential for schema migration and synchronization.
    *   `validate-storage.ts`: Checks read/write permissions for critical storage locations at startup, such as the SQLite database directory (if used) and local file upload directories, logging warnings if issues are found.
-   **Data Transformation & Manipulation**:
    *   `map-values-deep.ts`: Recursively applies a callback function to each non-object/non-array value in a nested object or array, allowing for deep transformation of data. The callback receives the full path to the value and the value itself.
    *   `merge-version-data.ts`: Provides functions (`mergeVersionsRaw` for shallow, `mergeVersionsRecursive` for deep) to apply versioned changes to an item. The recursive version handles nested relational data and applies "alterations" (create, update, delete operations on related items) based on schema definitions.
    *   `move-in-array.ts`: Moves an element within an array from a `fromIndex` to a `toIndex`, returning a new array.
    *   `number-generator.ts`: A generator function (`function*`) that yields an infinite sequence of incrementing numbers, starting from 0 (0, 1, 2, ...).
-   **String Utilities**:
    *   `md.ts`: Renders a Markdown string to HTML using the `marked` library and then sanitizes the output HTML using `sanitize-html` to prevent XSS vulnerabilities. Essential for safely displaying user-generated Markdown content.
    *   `pluralize.ts`: Provides very basic `pluralize` (adds "s") and `depluralize` (removes last character) functions. Suitable for simple, regular pluralizations only.
    *   `to-lower-case.ts`: Converts a string or an array of strings to lowercase. Recursively applies to array elements.
    *   `user-name.ts`: Formats user names for display by attempting to use full name, then first name, then email, with a fallback to "Unknown User".
-   **URL/Path Utilities**:
    *   `normalize-path.ts`: Normalizes a file or URL path string by converting backslashes to forward slashes, handling some Windows UNC path prefixes, and optionally removing leading slashes.
    *   `url.ts`: Provides a `Url` class for robust parsing, manipulation (adding path segments, setting query parameters), and reconstruction of URL strings, with support for various URL types (absolute, protocol-relative, root-relative).
-   **Caching**:
    *   `should-clear-cache.ts`: Determines if the cache (Keyv instance) should be cleared after a data mutation, based on environment variables (`CACHE_AUTO_PURGE`, `CACHE_AUTO_PURGE_IGNORE_LIST`), per-mutation options, and the collection being modified. Acts as a type guard for the cache instance.
    *   `should-skip-cache.ts`: Determines if caching should be skipped for an incoming Express request. Considers factors like the `Referer` header (to skip cache for admin panel requests under certain conditions related to `CACHE_AUTO_PURGE` and `CACHE_AUTO_PURGE_IGNORE_LIST`) and the `Cache-Control: no-store` request header (if `CACHE_SKIP_ALLOWED` is enabled).
-   **Async Utilities**:
    *   `stall.ts`: An async function that pauses execution to ensure a code block takes a minimum specified duration. Useful for mitigating timing attacks in security-sensitive operations (e.g., authentication) by normalizing response times.
    *   `transaction.ts`: Executes a given handler function within a Knex.js database transaction. It uses an existing transaction if active on the Knex instance, or creates a new one, preventing nested transaction issues.
    *   `schedule.ts`: Provides `validateCron` to check cron expressions and `scheduleSynchronizedJob` to schedule tasks using `node-schedule`. The latter ensures synchronized execution across multiple instances via a `SynchronizedClock`, preventing duplicate job runs.
-   **Node.js Specific**:
    *   Located in the `node/` subdirectory, these might include utilities for file system operations or other Node-specific APIs. (Example: `node/get-file-permissions.ts`, `node/read-dir.ts` if they exist).
-   **Application Specific**:
    *   Some utilities are highly specific to the application's domain, which is deeply tied to the application's data model and sharing logic. They should be listed under /application-specific

### Node.js Specific Utilities (`node/`)

This subdirectory contains helpers that are specific to the Node.js environment, often interacting with the file system, streams, or Node.js core modules.

*   **`array-helpers.ts`**:
    *   `isIn(value: string, array: readonly string[])`: Type guard to check if a string `value` exists in a readonly string `array`.
    *   `isTypeIn(object: { type?: string }, array: readonly string[])`: Type guard to check if an `object`'s `type` property exists in a readonly string `array`.
*   **`get-node-env.ts`**:
    *   `getNodeEnv()`: Retrieves the `NODE_ENV` environment variable (e.g., "production", "development").
*   **`is-readable-stream.ts`**:
    *   `isReadableStream(input: any)`: Type guard to determine if an `input` is a Node.js `Readable` stream by inspecting its properties and methods.
*   **`list-folders.ts`**:
    *   `listFolders(location: string, options?: { ignoreHidden?: boolean })`: Asynchronously lists all subdirectories within a specified `location`. Options allow ignoring hidden folders (those starting with a period).
*   **`path-to-relative-url.ts`**:
    *   `pathToRelativeUrl(filePath: string, root = '.')`: Converts a file system `filePath` into a relative URL string, ensuring forward slashes (`/`) as path separators, relative to an optional `root` path.
*   **`process-id.ts`**:
    *   `processId()`: Generates and caches a unique MD5 hash identifying the current Node.js process. The hash is derived from the hostname, process ID (PID), and current timestamp, making it unique per process instance.
*   **`readable-stream-to-string.ts`**:
    *   `readableStreamToString(stream: Readable)`: Asynchronously consumes a Node.js `Readable` stream and converts its entire content into a single UTF-8 encoded string.
*   **`resolve-package.ts`**:
    *   `resolvePackage(name: string, root?: string)`: Resolves the root directory path of a specified npm `name`. It can optionally start the search from a given `root` directory.
*   **`tmp.ts`**:
    *   `createTmpDirectory()`: Asynchronously creates a unique temporary directory (prefixed with 'yourpartner-') in the system's temporary folder. Returns an object with the `path` and a `cleanup` function to remove the directory.
    *   `createTmpFile()`: Asynchronously creates a temporary directory and then a uniquely named temporary file within it. Returns an object with the file `path` and a `cleanup` function to remove both the file and its parent temporary directory.
    
## Usage and Contribution

When adding new utilities to this directory, ensure they are well-tested, clearly documented, and genuinely reusable. If a helper is too specific to a single module or service, consider keeping it co-located with that module.

Categorize new utilities appropriately in this README to maintain discoverability.
