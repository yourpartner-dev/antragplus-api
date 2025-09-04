# API Specification (`src/specs`)

This directory contains the OpenAPI (version 3.0.1) specification for the YP application's API. The specification is structured modularly to enhance organization, maintainability, and collaboration.

## Overview of the Specification System

The API specification is designed around a main entry point (`openapi.yaml`) that references numerous other YAML files located in subdirectories. This approach allows for a clean separation of concerns, where individual API paths, reusable components (like schemas, parameters, responses), and other definitions are maintained in dedicated files.

Tooling designed for OpenAPI (e.g., validators, documentation generators, code generators) can process this structure by resolving the `$ref` pointers to assemble the complete API definition.

### Key Files and Directories:

*   **`openapi.yaml` (Root File)**:
    *   Serves as the primary entry point for the OpenAPI specification.
    *   Defines global information such as `info` (title, description, version), `tags` for grouping operations, and potentially global `servers` or `security` configurations.
    *   Crucially, it uses `$ref` keywords extensively to link to definitions in other files. For example:
        *   The `paths` section references files within the `paths/` subdirectory for individual API endpoint definitions.
        *   The `components` section (including `schemas`, `responses`, `parameters`, etc.) references files within corresponding subdirectories (`components/`, `responses/`, `parameters/`, and potentially `definitions/`).
    *   May include custom extensions (e.g., `x-collection`, `x-authentication` within tags) for internal use or specialized documentation.

*   **`paths/` (Subdirectory)**:
    *   This directory is further organized into subdirectories, typically named after major API resources or functional areas (e.g., `activity/`, `users/`, `items/`).
    *   Each subdirectory contains one or more YAML files. Each such YAML file typically defines the API operations (GET, POST, PUT, DELETE, etc.) for a single API path. For instance, a file like `paths/activity/activities.yaml` would define the operations for the `/activity` endpoint.
    *   These files are referenced from the main `paths` section of `openapi.yaml` using `$ref`. For example, `openapi.yaml` might have `/activity: $ref: './paths/activity/activities.yaml'`.
    *   **Structure of Path Definition Files**: Inside these files, each HTTP method (e.g., `get:`, `post:`) for the path is defined with:
        *   `operationId`, `summary`, `description`.
        *   `parameters`: Often uses `$ref` to link to reusable parameter definitions located in `components/parameters/` (via `../../openapi.yaml#/components/parameters/...`).
        *   `requestBody`: If applicable, may also use `$ref` for reusable request body definitions or schemas.
        *   `responses`: Defines possible HTTP status codes. Each response often uses `$ref` to link to reusable response definitions (e.g., for success schemas or common error responses like 401, 404) found in `components/responses/` or `components/schemas/`.
        *   `tags`: To associate the operations with the globally defined tags.
    *   This structure promotes reusability and keeps the definition for each API path concise and focused on its specific operations, while delegating common definitions to the `components/`, `parameters/`, and `responses/` directories.

*   **`components/` (Subdirectory)**:
    *   This directory houses YAML files that define reusable data structures (schemas) for the API. Each file typically corresponds to a single data model or object type (e.g., `activity.yaml`, `user.yaml`, `file.yaml`).
    *   **Referencing**: The main `openapi.yaml` file, under its `components.schemas` section, references these files. For example, `openapi.yaml` might contain:
        ```yaml
        components:
          schemas:
            Activity: 
              $ref: './components/activity.yaml'
            Users:
              $ref: './components/user.yaml' # (Example, actual filename might vary)
        ```
    *   **Structure of Schema Definition Files**: Each YAML file in `components/` typically defines:
        *   `type: object`
        *   `properties`: A map of field names to their definitions (including `type`, `description`, `example`, `format`, `enum`, `nullable`).
        *   These schema files can also internally use `$ref` to link to other schemas defined in `components/` (e.g., an `Order` schema might reference a `User` schema for a `created_by_user` field using a path like `../openapi.yaml#/components/schemas/Users`).
    *   **Purpose**: This modular approach to schemas ensures that data structures are defined once and reused across multiple API operations (in request bodies, response bodies), promoting consistency and maintainability. Tools resolve these `$ref`s to understand the complete structure of data exchanged by the API.
    *   While primarily for schemas, this directory *could* also be organized with subdirectories for other component types (e.g., `components/parameters/`, `components/responses/`) if the project chose not to use the top-level `parameters/` and `responses/` directories, or it might contain only schemas if those other directories are used for their respective component types.

*   **`responses/` (Subdirectory)**:
    *   This directory stores YAML files, each defining a complete, reusable API response. These are particularly useful for standardizing common responses, such as error responses (e.g., 401 Unauthorized, 404 Not Found).
    *   **Referencing**: The main `openapi.yaml` file, under its `components.responses` section, assigns a name to each reusable response and references the corresponding file. For example:
        ```yaml
        components:
          responses:
            UnauthorizedError: 
              $ref: './responses/unauthorizedError.yaml'
            NotFoundError:
              $ref: './responses/notFoundError.yaml'
        ```
    *   **Structure of Response Definition Files**: Each file (e.g., `unauthorizedError.yaml`) typically defines:
        *   `description`: A human-readable description of the response.
        *   `content`: Specifies the media type (e.g., `application/json`) and its `schema`, which defines the structure of the response body.
    *   **Usage**: API operations defined in the `paths/` files can then reference these named responses using `$ref: '../../openapi.yaml#/components/responses/UnauthorizedError'` for the appropriate HTTP status code. This ensures consistency in how common responses are handled across the API.

*   **`parameters/` (Subdirectory)**:
    *   This directory contains YAML files, each defining a single, reusable API parameter (e.g., for query, path, header, or cookie parameters).
    *   Common examples found here include `limit.yaml`, `offset.yaml`, `fields.yaml`, `sort.yaml`, `filter.yaml`, `id.yaml` (for path parameters), etc.
    *   **Referencing**: The main `openapi.yaml` file, under its `components.parameters` section, assigns a name to each reusable parameter and references the corresponding file. For example:
        ```yaml
        components:
          parameters:
            Limit:
              $ref: './parameters/limit.yaml'
            Fields:
              $ref: './parameters/fields.yaml'
        ```
    *   **Structure of Parameter Definition Files**: Each file (e.g., `limit.yaml`) typically defines:
        *   `name`: The name of the parameter.
        *   `in`: The location of the parameter (e.g., `query`, `path`, `header`).
        *   `description`: A human-readable description.
        *   `required`: A boolean indicating if the parameter is mandatory.
        *   `schema`: Defines the data type of the parameter (e.g., `type: integer`, `type: string`).
    *   **Usage**: API operations defined in `paths/` files include these parameters by referencing their names from `openapi.yaml#/components/parameters/`. This promotes consistency for common parameters like pagination, filtering, and sorting across different endpoints.

*   **`definitions/` (Subdirectory)**:
    *   This directory contains `query.yaml`, which defines a schema for a comprehensive Query object. This object encapsulates various query parameters like `fields`, `filter`, `search`, `sort`, `limit`, `offset`, `page`, and `deep` (for nested queries).
    *   **Purpose and Usage**: 
        *   While individual query parameters (like `limit`) are defined in `parameters/` for direct use in HTTP GET requests, the `definitions/query.yaml` schema is likely used to define the structure of a single, complex query object. 
        *   This query object might be accepted in the request body of certain API endpoints (e.g., a POST endpoint for advanced search/filtering) or used internally by the application to aggregate and process query parameters.
        *   It could be formally registered under `components.schemas` in `openapi.yaml` (e.g., `Query: $ref: '../definitions/query.yaml'`) to be referenceable in other parts of the specification, or its usage might be a convention for internal tooling or documentation.
