# Command Line Interface (CLI) for YP Application

This document provides an overview of the command-line interface (CLI) tool for the YP application, located in the `src/cli` directory. The CLI enables various administrative, setup, and operational tasks.

## Overview

The YP CLI is built using the `commander` library and provides a set of commands to manage the application, interact with the database, handle user and role creation, and perform initial project setup.

## Running the CLI

The CLI can be run in two ways:

1. Using npm/pnpm scripts (recommended):
```bash
# Project Initialization
pnpm yp:init           # Interactive project setup wizard
pnpm yp:bootstrap      # Programmatic database initialization

# Database Commands
pnpm database:install  # Install initial database schema and system data
pnpm migrate:latest    # Run all pending migrations
pnpm migrate:up        # Run the next pending migration
pnpm migrate:down      # Roll back the last migration
```

2. Using the CLI directly (for advanced usage):
```bash
pnpm cli [command] [options]
```

The entry point for the CLI is `src/cli/run.ts`, which executes `src/cli/index.ts` to define and parse commands.

## Available Commands

Below is a list of available commands and their functionalities.

### Project Initialization

*   **`pnpm yp:init`**
    *   Description: Interactive first-time project setup wizard for new YP installations.
    *   Use Case: Use this command when setting up a new YP project from scratch.
    *   Actions:
        *   Prompts for project name (used to generate database name for PostgreSQL).
        *   Prompts for database client selection.
        *   Installs the required database driver npm package.
        *   Prompts for database credentials (questions vary by selected client, defined in `src/cli/commands/init/questions.ts`).
        *   For PostgreSQL:
            *   Automatically creates a database with a name based on the project name
            *   Creates all necessary system tables
            *   Runs all migrations to the latest version
        *   For other databases:
            *   Attempts to run database seeds and latest migrations, with a retry mechanism for credential input
        *   Creates a `.env` file in the project root, populated with database details and a generated `SECRET`.
        *   Prompts for the first admin user's email and password.
        *   Creates the default admin role and the specified admin user in the database.
        *   Provides instructions on how to start the application.

*   **`pnpm yp:bootstrap`**
    *   Description: Programmatic database and system initialization/update tool.
    *   Use Case: Use this command for:
        *   Automated/CI environments where interactive prompts aren't desired
        *   Re-initializing an existing database
        *   System recovery or maintenance scenarios
        *   Running migrations on an existing installation
    *   Options:
        *   `--skipAdminInit`: If provided, skips the creation of the default Admin Role and User.
    *   Actions:
        *   Waits for a database connection with retry logic.
        *   If the database is not yet installed:
            *   Runs database seeds (installs system tables).
            *   Runs all pending migrations to the latest version.
            *   Creates a default "Administrator" role and an admin user (unless `--skipAdminInit` is used). Admin credentials can be pre-configured via `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables; if `ADMIN_PASSWORD` is not set, a random one is generated and logged.
            *   Sets the `project_name` in application settings if the `PROJECT_NAME` environment variable is defined.
        *   If the database is already installed, it only runs pending migrations to the latest version.

### Database Commands

*   **`pnpm database:install`**
    *   Description: Installs the initial database schema and system data (seeds).
    *   Action: Runs the seed scripts located in `src/database/seeds/`.

*   **`pnpm migrate:latest`**
    *   Description: Migrates the database to the latest version by applying all pending migrations.

*   **`pnpm migrate:up`**
    *   Description: Applies the next single pending migration.

*   **`pnpm migrate:down`**
    *   Description: Rolls back the last applied migration.

### Advanced CLI Commands

For commands not available as npm scripts, use the CLI directly:

```bash
# Security Commands
pnpm cli security key:generate    # Generate a new APP_KEY
pnpm cli security secret:generate # Generate a new SECRET

# User Management
pnpm cli users create --email <value> --password <value> --role <value>
pnpm cli users passwd --email <value> --password <value>

# Role Management
pnpm cli roles create --role <value> [--admin]

# Collection Operations
pnpm cli count <collection>
```

## CLI Utilities (`src/cli/utils/`)

The CLI commands are supported by several utility functions:

*   **`create-db-connection.ts`**: Creates a Knex.js database connection instance based on provided client and credentials.
*   **`defaults.ts`**: Provides default object structures for creating the initial admin user and admin role (used by `init` and `bootstrap`).
*   **`drivers.ts`**: Defines available database drivers (e.g., PostgreSQL) and provides a helper to get a driver code from its display name.
*   **`create-env/index.ts`**: Handles the creation of the `.env` file. It uses `env-stub.liquid` as a template, populates it with database credentials and a generated `SECRET`, and writes it to the project root.

## Event Emitter

The CLI lifecycle includes events emitted via `../emitter.js`:
*   `cli.before`: Emitted before commands are parsed.
*   `cli.after`: Emitted after commands have been set up.
This allows other parts of the application to extend or interact with the CLI. 