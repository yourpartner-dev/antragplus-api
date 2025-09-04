# Validation Helpers Documentation

This directory (`src/helpers/validation/`) provides utilities for standardizing and handling validation errors, primarily by translating errors from the Joi validation library into a custom application-specific error format.

## Core Functionality

*   **Custom Validation Error:** Defines a `FailedValidationError` class for representing validation failures in a structured way.
*   **Joi Error Translation:** Converts detailed error items from Joi's validation process into the custom `FailedValidationErrorExtensions` format.
*   **Human-Readable Messages:** Constructs user-friendly error messages based on the structured validation failure information.

## Key Components

### 1. `FailedValidationError` (`errors/failed-validation.ts`)

*   **Purpose:** A custom error class designed to represent specific validation failures within the application.
*   **Creation:** It's created using a generic `createError` function (likely from `src/helpers/errors/index.js`).
*   **Structure (`FailedValidationErrorExtensions`):** This interface defines the expected structure for additional details accompanying the error. It includes:
    *   `field`: The name of the field that failed validation.
    *   `type`: The type of validation failure (e.g., `eq`, `gt`, `in`, `required`, `regex`, `email`, `contains`). These types map to common filter operators or validation rules.
    *   `valid` (optional): The expected valid value or array of values.
    *   `invalid` (optional): The actual invalid value or array of values that caused the failure.
    *   `substring` (optional): The substring involved in `contains` or `starts_with`/`ends_with` type validations.
*   **Message Construction:** The `messageConstructor` function takes the `FailedValidationErrorExtensions` object and dynamically builds a human-readable error message (e.g., "Validation failed for field \"fieldName\". Value has to be greater than \"10\".").
*   **HTTP Status Code:** Associated with an HTTP 400 (Bad Request) status code.

### 2. Joi Error Translation (`utils/joi-to-error-extensions.ts`)

*   **`joiValidationErrorItemToErrorExtensions(validationErrorItem: ValidationErrorItem): FailedValidationErrorExtensions`**
    *   **Purpose:** Translates a single `ValidationErrorItem` object from the Joi validation library into the application's `FailedValidationErrorExtensions` format.
    *   **Logic:**
        *   It inspects the `type` property of the Joi error item (e.g., `string.min`, `any.required`, `number.less`, `string.pattern.base`).
        *   Based on this Joi type and the associated `context` (which contains details like limits, valid values, regex patterns), it maps the Joi error to one of the custom `type` values defined in `FailedValidationErrorExtensions`.
        *   It extracts relevant information from `validationErrorItem.context` (like `limit`, `valids`, `invalids`, `substring`, `value`, `name`, `regex`) and populates the corresponding fields in the `FailedValidationErrorExtensions` object.
        *   For example, a Joi `number.greater` error would be mapped to `type: 'gt'` and the `valid` field would be set to `validationErrorItem.context?.limit`.
        *   It handles various Joi rule types, including equality, ranges, presence, patterns, and specific named patterns (like `starts_with`).

### 3. Index Files (`index.ts`)
*   The `index.ts` files in `./`, `./errors/`, and `./utils/` serve as convenient re-exporters of the `FailedValidationError` class and the `joiValidationErrorItemToErrorExtensions` function, simplifying their import path in other parts of the application.

## Usage Flow

1.  Data is validated using the Joi library.
2.  If Joi reports validation errors, each `ValidationErrorItem` from Joi's error details can be passed to `joiValidationErrorItemToErrorExtensions`.
3.  This function returns a `FailedValidationErrorExtensions` object.
4.  This structured object can then be used to instantiate a `FailedValidationError`.
5.  The `FailedValidationError` (with its automatically constructed message and structured extensions) can be thrown or returned, providing a consistent and informative way to handle and report validation issues, for example, in an API response.

This module promotes a standardized approach to validation error handling, making it easier to process and display meaningful error information to users or client applications. 