# System Data (`src/helpers/system-data`)

This directory is responsible for defining and managing core system data and configurations for the application. It primarily uses YAML files to specify schema-like information such as collections, fields, relations, and permissions, which are then loaded and made available to the application.

## Overview

The primary purpose of this module is to provide a centralized and structured way to define the application's foundational data model and access control rules. By using YAML files, these definitions are human-readable and easy to manage.

Key components:

*   **`load-yaml.ts`**: Contains a utility function (`loadYamlFile`) responsible for reading and parsing YAML files from this directory structure.
*   **`types.ts`**: Defines TypeScript types and interfaces that correspond to the structure of the data defined in the YAML files. This ensures type safety when working with these configurations in the application.
*   **`index.ts`**: Aggregates and exports all the loaded and typed system data from the various subdirectories, making it accessible to other parts of the application.

## Directory Structure and Contents

The system data is organized into the following subdirectories:

### 1. `collections/`
   *   **Purpose**: Defines the main data collections (analogous to tables or entities) used in the application.
   *   **Files**: Contains `collections.yaml` which lists and describes these collections, and an `index.ts` to load and export them.

### 2. `fields/`
   *   **Purpose**: Specifies the detailed field definitions for various system and user-defined collections.
   *   **Files**: Contains multiple YAML files that define the fields, their types, properties, and default values for each collection:
     *   `_defaults.yaml`: Default field configurations shared across collections
     *   `users.yaml`: User-specific fields and configurations
     *   `roles.yaml`: Role management fields
     *   `files.yaml`: File storage and metadata fields
     *   `organizations.yaml`: Organization management fields
     *   An `index.ts` loads and exports these field definitions.

### 3. `relations/`
   *   **Purpose**: Defines the relationships (e.g., one-to-one, one-to-many, many-to-many) between different collections.
   *   **Files**: Contains `relations.yaml` to specify these relationships, and an `index.ts` to load and export them.
   *   **Key Relationships**:
     *   Organizations to Files (for logo management)
     *   Organizations to Users (for organization membership)
     *   Organizations to Roles (for organization-specific roles)

### 4. `app-access-permissions/`
   *   **Purpose**: Manages application-level access permissions and possibly schema-specific access rules.
   *   **Files**: Contains `app-access-permissions.yaml` and `schema-access-permissions.yaml` to define these permissions, and an `index.ts` to load and export them.

## Field Definitions

Each field in the YAML files typically includes:

*   **Type**: The data type (string, integer, uuid, etc.)
*   **Meta**: UI and validation metadata
    *   Interface: The form control type (input, select, file-image, etc.)
    *   Width: Layout control (full, half, etc.)
    *   Options: Additional configuration (validation, formatting, etc.)
*   **Special Fields**:
    *   File fields (like organization logo) include file handling options
    *   Status fields include predefined choices
    *   Timestamp fields include readonly flags
    *   JSON fields include language specifications

## How It Works

1.  **Data Definition**: Core system data schemas and configurations are defined in human-readable YAML files within the respective subdirectories.
2.  **Loading**: The `index.ts` file in each subdirectory typically uses the `loadYamlFile` utility from `load-yaml.ts` to read and parse its corresponding YAML file(s).
3.  **Typing**: The data loaded from YAML is often cast or validated against the types defined in `types.ts` to ensure consistency and provide type safety.
4.  **Aggregation & Export**: The main `src/helpers/system-data/index.ts` file re-exports all the processed and typed data from the subdirectories, making a unified system data object available for the rest of the application.

## Usage

Other modules within the application can import the necessary system data directly from `@/helpers/system-data` (or the relevant path based on project configuration).

```typescript
import { collections, fields, relations } from '@/helpers/system-data';

// Example: Accessing field definitions for the 'organizations' collection
const organizationFields = fields.organizations;

// Example: Getting the definition for a specific collection
const orgCollection = collections.find(c => c.collection === 'yp_organizations');
```

This centralized approach to managing system data ensures consistency and makes it easier to update or extend the application's core model and rules. 