# Database Management (`src/database`)

This directory encapsulates all database-related operations and management for the application. It provides a comprehensive abstraction layer using Knex.js for SQL query building, along with functionalities for schema management, migrations, data seeding, and dialect-specific helpers.

## Overview

The primary goal of this module is to centralize database interactions, making them consistent, configurable, and easier to manage across the application. It supports various database clients through Knex.js and includes mechanisms for environment-based configuration, logging, and validation.

Key features include:

*   **Knex.js Integration**: Uses Knex.js as the SQL query builder, allowing for flexible and secure database queries.
*   **Singleton Connection**: Provides a singleton pattern for accessing the Knex database instance (`getDatabase()`).
*   **Configuration**: Database connection and behavior are configured via environment variables (e.g., `DB_CLIENT`, `DB_HOST`, `DB_CONNECTION_STRING`).
*   **Schema Inspection**: Offers utilities to inspect the database schema (tables, columns, etc.) in a dialect-agnostic way (`getSchemaInspector()`).
*   **Migrations**: Manages database schema evolution through timestamped migration files located in `src/database/migrations/`.
*   **Data Seeding**: Supports populating the database with initial data using YAML definitions and a runner script in `src/database/seeds/`.
*   **Database Helpers**: Provides a suite of helper functions for common database operations, potentially including dialect-specific logic for data types like geometry, dates, etc., in `src/database/helpers/`.
*   **Error Handling**: Includes utilities for translating database-specific errors into a more generic format in `src/database/errors/`.
*   **Validation**: Contains routines to validate database connections, migration status, and the presence of optional database extensions (like PostGIS).

## Key Components

*   **`index.ts` (Main Module)**:
    *   Exports `getDatabase()`: The primary function to obtain a configured Knex.js instance (singleton).
    *   Exports `getSchemaInspector()`: Provides access to the database schema inspection tools.
    *   Exports validation functions: `hasDatabaseConnection`, `validateDatabaseConnection`, `validateMigrations`, `validateDatabaseExtensions`, `isInstalled`.
    *   Handles Knex configuration based on environment variables, including connection pooling and logging integration.
    *   Sets up query logging with execution times.

*   **`run-ast.ts`**: 
    *   **Purpose**: A sophisticated data fetching engine that executes queries defined by an Abstract Syntax Tree (AST) structure against the database using Knex.
    *   **Functionality**:
        *   Takes an AST (defining collections, fields, relationships, functions, filters, sorting, aggregation, etc.) and a schema overview as input.
        *   Recursively processes the AST to build and execute efficient Knex.js queries.
        *   Handles the fetching and merging of data for nested relationships (one-to-many, many-to-one, and other complex relations), including batching for performance.
        *   Determines required columns for selection, including primary/foreign keys for joins, and can strip temporary internal fields from the final output.
        *   Applies SQL functions to columns and handles special data types (e.g., geometry) using database-specific helpers.
        *   Utilizes a `PayloadService` for post-processing of fetched data.
    *   **Use Case**: Allows the application to request complex, deeply nested and structured data via a single declarative AST query, which this module then resolves against the database. This is a common pattern in GraphQL-like APIs or advanced data access layers.

*   **`schema/` subdirectory**:
    *   Implements the database schema inspector (`createInspector`).
    *   Contains `dialects/`, `types/`, and `utils/` subdirectories, suggesting it provides an abstraction layer for schema introspection across different database systems.

*   **`migrations/` subdirectory**:
    *   Stores timestamped Knex.js migration files (e.g., `20250430A-add-activity-stream.ts`). Each file typically defines `up` and `down` functions for applying and reverting schema changes.
    *   Includes a `run.ts` script, likely for programmatically executing migrations.

*   **`seeds/` subdirectory**:
    *   Contains YAML files defining data for various tables (e.g., `02-roles.yaml`, `03-users.yaml`).
    *   Includes a `run.ts` script to parse these YAML files and insert data into the database using Knex.

*   **`helpers/` subdirectory**:
    *   Provides a collection of database utility functions, organized into subdirectories like `date/`, `geometry/`, `number/`, `schema/`, `fn/`, and `sequence/`.
    *   These helpers likely abstract common SQL patterns or provide support for specific data types and operations.

*   **`errors/` subdirectory**:
    *   Contains logic (`translate.ts` and `dialects/`) for translating low-level database errors into more application-friendly or standardized errors, possibly integrating with the application's main error handling system.

## How It Works

1.  **Initialization**: The `getDatabase()` function is called to obtain a Knex instance. On the first call, it reads `DB_*` environment variables, configures Knex, establishes a connection pool, and sets up logging.
2.  **Querying**: The obtained Knex instance is used throughout the application to build and execute SQL queries.
3.  **Schema Management**: Migrations in `migrations/` are run (e.g., via the `run.ts` script or Knex CLI) to update the database schema. The `schema/` inspector can be used to understand the current schema structure.
4.  **Seeding**: The `seeds/run.ts` script can be executed to populate the database with initial data from YAML files.
5.  **Helpers & Utilities**: Various helper functions from `helpers/` can be used to simplify common database tasks. Database-specific errors are translated by the `errors/` module.

## Configuration (Environment Variables)

Key environment variables that drive the database configuration include:

*   `DB_CLIENT`: The database client (e.g., `pg`, `mysql2`, `sqlite3`).
*   `DB_CONNECTION_STRING`: A full connection string.
*   Alternatively, individual parameters if `DB_CONNECTION_STRING` is not provided:
    *   `DB_HOST`
    *   `DB_PORT`
    *   `DB_DATABASE`
    *   `DB_USER`
    *   `DB_PASSWORD`
*   `DB_POOL_MIN`, `DB_POOL_MAX`: For connection pool configuration.
*   `DB_SEARCH_PATH`: For PostgreSQL schemas.
*   `DB_EXCLUDE_TABLES`: Likely used by schema inspection or other utilities.

## Usage Example

```typescript
import getDatabase, { getSchemaInspector, validateDatabaseConnection } from '@/database'; // Adjust path as needed

async function main() {
    await validateDatabaseConnection(); // Ensure DB is connectable

    const db = getDatabase();

    // Example: Querying users
    try {
        const users = await db('users').select('id', 'username').where('status', 'active');
        console.log('Active users:', users);
    } catch (error) {
        console.error(error, 'Error fetching users');
    }

    // Example: Using schema inspector
    const inspector = getSchemaInspector();
    const hasUsersTable = await inspector.hasTable('users');
    console.log(`Database has 'users' table: ${hasUsersTable}`);

    if (hasUsersTable) {
        const usersColumns = await inspector.columns('users');
        console.log('Columns in users table:', usersColumns.map(c => c.column_name));
    }
}

main();
```

This module provides a solid foundation for all database operations, promoting consistency, maintainability, and testability. 