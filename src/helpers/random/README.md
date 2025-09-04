# Random Data Generation Helpers (`src/helpers/random`)

This directory provides a collection of utility functions for generating various types of random data, such as strings, numbers, UUIDs, and sequences.

## Overview

These helpers are useful for tasks like creating unique identifiers, generating test data, or any scenario where random values are needed. The utilities are generally straightforward and aim to provide simple interfaces for common random generation needs.

## Key Components & Functionalities

The main utilities are exported via `index.ts` and include:

*   **`alpha.ts` (`randomAlpha(length: number): string`)**
    *   Generates a random string of a specified `length` consisting of lowercase alphabetic characters (a-z).
    *   Uses `randomSequence` internally with the character set defined in `constants.ts` (`CHARACTERS_ALPHA`).

*   **`array.ts` (`randomArrayItem<T>(items: T[]): T | undefined`)**
    *   Likely (assuming typical functionality) returns a random item from the provided `items` array. Returns `undefined` if the array is empty.

*   **`identifier.ts` (`randomIdentifier(length: number = 8): string`)**
    *   Likely generates a random alphanumeric identifier, possibly defaulting to a certain `length` (e.g., 8 characters). The exact character set used might be a combination of alphanumeric characters.

*   **`integer.ts` (`randomInteger(min: number, max: number): number`)**
    *   Returns a random integer between `min` (inclusive) and `max` (inclusive).

*   **`sequence.ts` (`randomSequence(length: number, characters: string): string`)**
    *   A core utility that generates a random string of a specified `length` by picking characters from the provided `characters` string.
    *   This is used by other helpers like `randomAlpha`.

*   **`uuid.ts` (`randomUUID(): string`)**
    *   Generates a standard Version 4 UUID (Universally Unique Identifier) using Node.js's built-in `crypto.randomUUID()`.

*   **`constants.ts`**
    *   Currently defines `CHARACTERS_ALPHA = 'abcdefghijklmnopqrstuvwxyz'`.
    *   May contain other character sets for different random generation functions.

## Usage Examples

```typescript
import {
    randomAlpha,
    randomInteger,
    randomUUID,
    randomIdentifier,
    // ... other random helpers
} from '@/helpers/random'; // Adjust path as per your project structure

// Generate a random 10-character alphabetic string
const alphaString = randomAlpha(10);
console.log(alphaString); // e.g., "jxqlnopzvm"

// Generate a random integer between 5 and 20
const randomNumber = randomInteger(5, 20);
console.log(randomNumber); // e.g., 12

// Generate a UUID
const id = randomUUID();
console.log(id); // e.g., "a1b2c3d4-e5f6-7890-1234-567890abcdef"

// Generate a random identifier
const ident = randomIdentifier(6);
console.log(ident); // e.g., "a3x7p2"
```

## Extending

New random generation utilities can be added by creating a new `.ts` file, implementing the function, adding a corresponding `.test.ts` file, and exporting the new function from `index.ts`.
If new character sets are needed, they can be added to `constants.ts`. 