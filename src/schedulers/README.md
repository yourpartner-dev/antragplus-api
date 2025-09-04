# Schedulers Module Documentation

This document provides an overview of the scheduling system used in this project. Schedulers are used to automate tasks that need to run periodically in the background, such as data processing, maintenance routines, report generation, or triggering notifications.

## Core Concepts

Schedulers in this system are time-based jobs defined by a cron expression and an asynchronous task function that performs the desired work. A helper function, `scheduleSynchronizedJob`, is central to defining and managing these jobs, ensuring that instances of the same named job do not run concurrently if a previous instance is still active.

Each distinct set of related scheduled tasks is often organized into its own processor module (e.g., `measure-processor.ts`, `queue-processor.ts`).

### Creating a Scheduler Module

A typical scheduler module involves:
1.  An initialization function (e.g., `initializeMyProcessor()`) that sets up one or more scheduled jobs.
2.  One or more asynchronous task functions that contain the core logic for each job.

**General Structure (`my-processor.ts`):**

```typescript
import { scheduleSynchronizedJob } from '../helpers/utils/schedule.js'; // Core scheduling helper
import { useLogger } from '../helpers/logger/index.js';
// Import necessary services, database access, schema helpers, types, etc.
// import { ItemsService } from '../services/items.js';
// import { getSchema } from '../helpers/utils/get-schema.js';
// import getDatabase from '../database/index.js';
// import { useEnv } from '../helpers/env/index.js';

const logger = useLogger();
// const env = useEnv(); // If environment variables are needed

// Initialization function for this scheduler module
export function initializeMyProcessor() {
    const myFirstJob = scheduleSynchronizedJob(
        'my-unique-job-name-1',  // A unique string identifier for this job
        '0 * * * *',             // Cron expression (e.g., every hour at minute 0)
        performMyFirstTask       // The async function to execute
    );

    const mySecondJob = scheduleSynchronizedJob(
        'my-unique-job-name-2',
        '*/5 * * * *',           // Cron expression (e.g., every 5 minutes)
        performMySecondTask
    );

    logger.info('MyProcessor initialized with scheduled jobs.');
    
    // Return job instances if they need to be managed (e.g., for cancellation)
    return {
        myFirstJob,
        mySecondJob
    };
}

// Async task function for the first job
async function performMyFirstTask() {
    logger.info('Starting myFirstTask...');
    try {
        // --- Business logic for the first task ---
        // const schema = await getSchema();
        // const itemsService = new ItemsService('some_collection', { accountability: null, schema });
        // const items = await itemsService.readByQuery({ limit: 10 });
        // logger.info(`Fetched ${items.length} items.`);
        
        logger.info('Successfully completed myFirstTask.');
    } catch (error: any) {
        logger.error('Error during myFirstTask:', error);
        // Rethrow or handle as appropriate for your application
    }
}

// Async task function for the second job
async function performMySecondTask() {
    logger.info('Starting mySecondTask...');
    try {
        // --- Business logic for the second task ---
        // const knex = getDatabase();
        // await knex.raw('SELECT process_data();');
        
        logger.info('Successfully completed mySecondTask.');
    } catch (error: any) {
        logger.error('Error during mySecondTask:', error);
    }
}
```

**Key Components:**

*   **`scheduleSynchronizedJob(jobName: string, cronExpression: string, taskFunction: () => Promise<void>)`**:
    *   `jobName`: A **unique string identifier** for the job. This is crucial for the "synchronized" aspect, preventing multiple instances of the same job from running simultaneously.
    *   `cronExpression`: A standard cron pattern string that defines when the job will run.
        *   Example: `* * * * *` - Every minute
        *   Example: `0 */2 * * *` - Every 2 hours at minute 0
        *   Example: `0 3 * * *` - Every day at 3:00 AM
    *   `taskFunction`: An asynchronous function (`async () => {...}`) that contains the logic to be executed when the job is triggered.

### Initialization and Application Integration

Scheduler modules need to be initialized by the main application to start their defined jobs. This typically happens during the application's bootstrap sequence in `src/app.ts`.

1.  **Individual Scheduler Module Initialization:** Each scheduler module (e.g., `my-processor.ts`) exports an initialization function (like `initializeMyProcessor()`). This function is responsible for calling `scheduleSynchronizedJob` for all tasks it manages.

2.  **Centralized or Direct Invocation from `app.ts`:**
    *   You might have a central scheduler initialization file (e.g., `src/scheduler.ts` or `src/schedulers/index.ts`) that imports and calls all individual processor initialization functions. This central file's main function would then be called from `app.ts`.
        ```typescript
        // Example: src/schedulers/index.ts (Conceptual)
        import { initializeMyProcessor } from './my-processor.js';
        import { initializeAnotherProcessor } from './another-processor.js';
        import { useLogger } from '../helpers/logger/index.js'; // Assuming logger is needed here

        const logger = useLogger();

        export function initializeAllSchedulers() {
            logger.info('Initializing all application schedulers...');
            initializeMyProcessor();
            initializeAnotherProcessor();
            // ... initialize other processors
            logger.info('All application schedulers initialized.');
        }
        ```
        And then in `src/app.ts`:
        ```typescript
        // Example: src/app.ts (Conceptual)
        // ... other imports in app.ts
        import { initializeAllSchedulers } from './schedulers/index.js';
        // ... 
        export default async function createApp(): Promise<express.Application> {
            // ... app setup ...
            initializeAllSchedulers();
            // ...
            return app;
        }
        ```
    *   Alternatively, as seen in the provided `app.ts` example, individual `initialize...Processor()` functions can be directly imported and called within `app.ts` itself towards the end of the `createApp` function.
        ```typescript
        // Example: Direct initialization in src/app.ts
        // ... other imports in app.ts
        import { initializeQueueProcessor } from './schedulers/queue-processor.js';
        // ... import other specific processor initializers

        export default async function createApp(): Promise<express.Application> {
            // ... other application setup ...

            // Initialize schedulers
            initializeQueueProcessor();
            // ... call other initializers

            return app;
        }
        ```

Regardless of the exact structure, the key is that the initialization functions for your schedulers are executed when the application starts, which in turn calls `scheduleSynchronizedJob` to get the tasks running on their defined schedules.

## Common Patterns & Best Practices

*   **Unique Job Names:** Ensure every call to `scheduleSynchronizedJob` uses a globally unique `jobName` string. This is critical for the synchronization logic to work correctly.
*   **Logging:** Use `useLogger()` consistently within task functions for detailed logging of job start, completion, significant steps, and any errors. This is essential for monitoring and debugging scheduled tasks.
*   **Error Handling:** Implement robust `try...catch` blocks within each `taskFunction` to handle potential errors gracefully. Log errors clearly and decide whether an error should halt further processing or if the job can recover.
*   **Idempotency:** Design tasks to be idempotent where possible. This means if a task runs multiple times with the same input or in the same state, it produces the same result without unintended side effects. This is helpful if a job is retried or runs partially due to an error.
*   **Resource Management:**
    *   **Services & Database Access:** Utilize existing services (`ItemsService`, `QueueManager`, etc.), `getSchema()`, and `getDatabase()` for business logic and data interaction, similar to how they are used in hooks or API endpoints. Pass `accountability: null` if the task is system-level and not tied to a specific user.
    *   **Batch Processing:** For tasks that process large volumes of data, implement batching to manage memory usage and improve performance. Fetch and process data in chunks rather than all at once.
*   **Configuration:**
    *   **Cron Expressions:** Store cron expressions in a way that's easy to manage. For highly configurable schedules, consider environment variables, but for most internal system tasks, defining them in code is common.
    *   **Environment Variables (`useEnv`):** Use environment variables for parameters that might change between environments (e.g., API keys, specific thresholds, feature flags for schedulers).
*   **Task Duration & Complexity:**
    *   Keep individual scheduled tasks focused. If a task becomes too complex or long-running, consider breaking it into smaller jobs or leveraging a queue system for parts of the workload.
    *   The "synchronized" nature of `scheduleSynchronizedJob` helps with long-running tasks by preventing overlap, but be mindful of tasks that might consistently take longer than their scheduled interval.
*   **Testing:** Develop strategies for testing scheduler logic. This might involve triggering tasks manually with specific inputs or mocking time-based components.

This system provides a robust way to define, schedule, and manage background tasks critical to your application's functionality. 