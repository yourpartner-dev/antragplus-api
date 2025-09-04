# Generic Queue Management System Documentation

This document provides an overview of the generic queue management system implemented within `src/services/queues/`. This system is designed to handle asynchronous tasks, manage message processing, and improve application resilience by decoupling task invocation from task execution, primarily leveraging Redis as a backend.

## Core Concepts

The queue system allows different parts of the application to offload tasks to be processed asynchronously. This is useful for long-running operations, third-party API interactions, or any task that doesn't need to be completed within the immediate request-response cycle.

Key features typically include:

*   **Message Persistence:** Queued tasks (messages) are stored (e.g., in Redis) until they are processed.
*   **Producers & Consumers:**
    *   Producers add messages/tasks to a queue.
    *   Consumers (or Workers) retrieve messages from the queue and execute the corresponding tasks.
*   **Retry Mechanisms:** Automatic retries for failed tasks with configurable backoff strategies.
*   **Dead-Letter Queues (DLQ):** Messages that repeatedly fail are moved to a DLQ for later inspection and manual intervention, preventing them from blocking the main queue.
*   **Scalability:** Allows for multiple worker instances to process tasks from the same queue, distributing the load.

## System Architecture

The queue management system is structured around a few key components:

### 1. Base Queue (`base-queue.ts`)

*   **Purpose:** This file defines the foundational abstract class or set of core functionalities for all queues in the system. It encapsulates the generic logic for:
    *   Connecting to the queue backend (e.g., Redis).
    *   Adding jobs (messages) to a queue.
    *   Retrieving jobs from a queue.
    *   Processing jobs, including error handling and retry logic.
    *   Moving jobs to a Dead-Letter Queue (DLQ) after exceeding retry limits.
    *   Basic queue monitoring and health checks (potentially).
*   **Key Features Defined Here:**
    *   Job serialization/deserialization.
    *   Interaction with Redis for list operations (LPUSH, BRPOP, LREM, etc.) or streams.
    *   Concurrency control for job processing (e.g., how many jobs a worker processes at once).
    *   Locking mechanisms (if needed) to ensure a job is processed by only one worker.

### 2. Queue Manager (`queue-manager.ts`)

*   **Purpose:** Acts as a centralized manager or factory for creating, accessing, and managing different queue instances. It provides a consistent interface for other services to obtain a specific queue they need to interact with.
*   **Functionality:**
    *   Instantiates and configures specific queue types (which would typically extend or use `BaseQueue`).
    *   May hold a registry of all active queues.
    *   Provides methods like `getQueue(queueName: string)` or specific getters like `getUserProcessingQueue()`.
    *   Potentially handles global queue configurations or shared resources.

### 3. Queue Implementations (`implementations/` directory)

*   **Purpose:** This directory is intended to house concrete implementations of specific queues. Each file or module within this directory would typically define a queue for a particular type of task (e.g., `EmailQueue`, `ReportGenerationQueue`).
*   **Structure:**
    *   These implementations would extend the `BaseQueue` class or compose its functionalities.
    *   They define the specific `processJob` logic for the tasks they handle.
    *   They register themselves or are registered with the `QueueManager`.

    *(Note: As per the requirement, specific implementations within this directory will be removed to keep the system generic. This description outlines where such client-specific or app-specific queues *would* reside.)*

### 4. Types (`types/` directory)

*   **Purpose:** Contains TypeScript interfaces and type definitions relevant to the queue system, such as:
    *   `JobPayload` interfaces for different task types.
    *   Queue configuration options.
    *   Worker status types.

### 5. Dead Letter Queue (`implementations/dead-letter-queue.ts`)

*   **Purpose:** This specific queue implementation handles items that have failed processing multiple times in their original queues.
*   **Functionality:**
    *   **Storage:** Stores `DeadLetterQueueItem` objects, which include the original queue name, the original item (job data), accountability, schema, error details, and a timestamp.
    *   **Cleanup & Retry (`processDeadLetterQueue` method):**
        *   Periodically (e.g., triggered by a scheduler calling `monitorQueueSizes` in `QueueManager`, which in turn calls `processDeadLetterQueue`), this method inspects items in the DLQ.
        *   Items older than a defined threshold (e.g., 4 hours) are removed permanently.
        *   For newer items, it attempts to re-queue them to their original queues.
    *   **Generic Reprocessing (`reprocessItem` method):**
        *   To re-queue an item, the `DeadLetterQueue` uses its `QueueManager` instance (passed during construction).
        *   It calls `queueManager.getQueue(originalQueueName)` to get an instance of the original queue.
        *   It then calls the `addToQueue(originalJobData)` method (from `BaseQueue`, accessed via the retrieved original queue instance) to put the job back into its original queue for another processing attempt.
        *   This mechanism is generic and does not require the `DeadLetterQueue` to know the specific structure or reprocessing logic for each individual queue type.

## Workflow

1.  **Initialization:** The `QueueManager` is initialized, often during application startup. It may pre-initialize commonly used queues or prepare for on-demand queue creation.
2.  **Producing a Job:**
    *   A service or controller needs to offload a task.
    *   It requests the appropriate queue instance from the `QueueManager`.
    *   It calls an `addJob` (or similar) method on the queue instance, providing the necessary payload for the task.
    *   The `BaseQueue` logic (within the specific queue instance) serializes the job and adds it to the Redis queue.
3.  **Consuming a Job:**
    *   Worker processes (which could be part of the main application or separate worker services) continuously monitor relevant queues for new jobs. This is often done via the `QueueManager` or directly on queue instances.
    *   The `BaseQueue` logic retrieves a job from Redis (e.g., using `BRPOP`).
    *   It deserializes the job payload.
    *   It invokes the specific `processJob` method defined in the concrete queue implementation.
    *   **Success:** If `processJob` completes successfully, the job is acknowledged and removed from the queue.
    *   **Failure:** If `processJob` throws an error:
        *   The `BaseQueue` logic catches the error.
        *   It logs the error and increments a retry counter for the job.
        *   If retries are not exhausted, the job might be re-queued (often with a delay).
        *   If retries are exhausted, the job is moved to a Dead-Letter Queue (DLQ). The `DeadLetterQueueItem` stored in the DLQ contains the original queue name and the original job data.

## Configuration

*   **Redis Connection:** Relies on the main Redis connection configured in `src/redis/`. The `BaseQueue` or `QueueManager` will use this shared Redis client.
*   **Queue-Specific Settings:** Each queue implementation might have its own configuration (e.g., queue name, retry limits, timeout values), which could be defined when the queue is instantiated or registered with the `QueueManager`.
*   **Worker Concurrency:** Configuration for how many jobs a worker can process concurrently.

## How to Create a New (Specific) Queue

*(This section describes the pattern, assuming client-specific implementations are added later.)*

1.  **Define Job Payload:** Create a TypeScript interface in `src/services/queues/types/` for the data your new queue will handle.
2.  **Create Implementation:** Inside the `src/services/queues/implementations/` directory, create a new file (e.g., `my-specific-task-queue.ts`).
    *   Define a class that extends `BaseQueue` (or uses its a similar compositional pattern).
    *   Implement the `processJob(payload: MySpecificTaskPayload): Promise<void>` method with the actual business logic for the task.
    *   Set any specific queue options (name, retries, etc.).
3.  **Register with QueueManager:** Update `QueueManager` to know about your new queue. This might involve adding a method to get an instance of your new queue, or a more dynamic registration mechanism.
4.  **Produce Jobs:** In your application code where the task needs to be initiated, get your new queue from the `QueueManager` and call its `addJob` method.
5.  **Ensure Workers Process It:** Ensure your worker setup is configured to listen to and process jobs from this new queue name.

This generic queue system provides a scalable and resilient foundation for handling asynchronous operations within your application. 