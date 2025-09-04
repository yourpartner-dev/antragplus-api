# Environment Variable Management (`src/helpers/env`)

This directory provides a robust and type-safe system for managing environment variables within the application. It supports loading configurations from multiple sources, applying default values, casting values to appropriate types, and even dereferencing file paths specified in environment variables to load their content.

## Overview

The core of this module is the `useEnv()` function, which returns a singleton, typed object representing the application's environment configuration. This object is constructed by `createEnv()`, which orchestrates the loading, merging, and processing of environment variables.

Key features:

*   **Typed Access**: Provides a strongly-typed `Env` object for accessing environment variables, enhancing developer experience and reducing runtime errors.
*   **Multiple Sources**: Loads configuration from:
    1.  Default values defined within the module.
    2.  The process environment (`process.env`).
    3.  A dedicated configuration file (e.g., `.env`).
*   **File Dereferencing**: Supports special environment variables that point to file paths. The content of these files is read and used as the variable's value (useful for secrets or large configurations).
*   **Type Casting**: Automatically casts string values from environment variables or files to their expected types (e.g., boolean, number, JSON array/object) based on predefined schemas or naming conventions.
*   **Singleton Access**: `useEnv()` ensures that the environment configuration is processed only once and provides a cached instance for subsequent calls.

## Key Components

*   **`index.ts`**: 
    *   Exports `useEnv()`, the primary function for accessing the typed environment object.
    *   Manages a cache (`_cache`) to store the singleton `Env` instance.

*   **`lib/create-env.ts` (`createEnv(): Env`)**: 
    *   The main orchestrator for building the `Env` object.
    *   **Loading Order & Merging** (conceptual):
        1.  Starts with predefined `DEFAULTS`.
        2.  Reads from `process.env` (via `readConfigurationFromProcess()`).
        3.  Reads from a configuration file (e.g., `.env`, path determined by `getConfigPath()`, parsed by `readConfigurationFromFile()`). File values typically override process environment values, which override defaults.
    *   **File Content Loading**: Iterates through the merged configuration. If a variable is marked as a file key (e.g., ending with `_FILE`), its string value is treated as a path, and the content of that file is read to become the actual value of the variable (with the `_FILE` suffix removed from the key).
    *   **Type Casting**: Uses the `cast(value, key)` function (from `lib/cast.ts`) to convert each raw string value to its appropriate JavaScript type based on mappings (likely managed by `getTypeFromMap()`).

*   **`lib/cast.ts` (`cast(value: any, key: string): any`)**: 
    *   Responsible for converting string environment variable values into their proper types (e.g., `'true'` to `true` (boolean), `'123'` to `123` (number), `'[\"a\"]'` to `['a']` (array)). It likely uses a type map associated with variable keys.

*   **`lib/read-configuration-from-file.ts`**: 
    *   Handles the logic for reading and parsing the environment configuration file (e.g., a `.env` file using a library like `dotenv`).

*   **`types/env.ts`**: 
    *   Defines the `Env` TypeScript interface. This interface lists all expected environment variables and their corresponding types, providing static type checking and autocompletion.

*   **`constants/defaults.ts`**: 
    *   Exports a `DEFAULTS` object containing default values for many environment variables.

*   **`utils/` subdirectory**: 
    *   Contains various helper functions such as:
        *   `getConfigPath()`: Determines the path to the environment configuration file.
        *   `getTypeFromMap()`: Maps variable keys to their expected data types for casting.
        *   `isYourPartnerVariable()`: Checks if a variable follows a specific naming convention.
        *   `isFileKey()`: Checks if a variable key indicates its value is a file path (e.g., by ending with `_FILE`).
        *   `readConfigurationFromProcess()`: Reads variables from `process.env`.
        *   `removeFileSuffix()`: Removes a suffix like `_FILE` from a key.

## How It Works

1.  The first call to `useEnv()` triggers `createEnv()`.
2.  `createEnv()` loads default values.
3.  It then loads variables from `process.env` and a configuration file, merging them (file usually overrides process, which overrides defaults).
4.  It iterates through this raw configuration. For variables designated as file pointers (e.g., `SECRET_KEY_FILE=/path/to/secret`), it reads the file's content as the variable's value.
5.  All variable values are then cast to their predefined types (e.g., string to boolean, number, array, object) based on a type mapping.
6.  The resulting typed `Env` object is cached by `useEnv()`.
7.  Subsequent calls to `useEnv()` return the cached, fully processed `Env` object.

## Usage Example

```typescript
import { useEnv } from '@/helpers/env'; // Adjust path as per your project structure

const env = useEnv();

// Access environment variables in a type-safe manner
const apiKey = env.API_KEY; // Type string (or as defined in Env interface)
const port = env.PORT;     // Type number (or as defined)
const enableFeature = env.ENABLE_FEATURE_X; // Type boolean (or as defined)

if (enableFeature) {
    console.log(`Feature X is enabled. API Key: ${apiKey}`);
}

console.log(`Server starting on port: ${port}`);

// If MY_SECRET_FILE=/path/to/my_secret.txt was in the environment,
// and my_secret.txt contained "supersecretvalue":
const mySecret = env.MY_SECRET; // Would contain "supersecretvalue"
```

This comprehensive environment management system ensures consistency, type safety, and flexibility in how the application's configuration is loaded and accessed. 