# Title Formatting Helper (`src/helpers/format-title`)

This directory provides a utility function, `formatTitle`, designed to convert various string formats (like camelCase, snake_case, kebab-case, or space-separated words) into a consistently formatted title string, often adhering to common title case conventions.

## Overview

The `formatTitle` function processes an input string through a series of transformations:
1.  **Decamelization**: Converts camelCase or PascalCase strings into words separated by spaces.
2.  **Splitting**: Splits the string into individual words based on common separators (spaces, hyphens, underscores).
3.  **Capitalization**: Initially capitalizes each word.
4.  **Special Word Handling**: Applies specific casing rules, such as keeping acronyms in uppercase (e.g., "API", "URL") and potentially lowercasing articles, short prepositions, and conjunctions unless they are the first or last word in the title.
5.  **Combining**: Joins the processed words back into a single string, typically with spaces.

## Key Components

*   **`index.ts`**: 
    *   Exports the main `formatTitle(title: string, separator = new RegExp('\\s|-|_', 'g')): string` function.
    *   This function orchestrates the formatting pipeline using helper utilities.

*   **`utils/` subdirectory**: Contains the core transformation logic:
    *   `decamelize.ts`: Converts camelCase/PascalCase to space-separated words.
    *   `capitalize.ts`: Capitalizes the first letter of a word.
    *   `handle-special-words.ts`: Implements the logic for special casing. This utility likely uses word lists from the `constants/` directory to identify acronyms, articles, conjunctions, prepositions, and other special-cased words to apply appropriate casing rules (e.g., APA or Chicago style title casing rules for minor words).
    *   `combine.ts`: Joins an array of words into a single string, usually with a space.

*   **`constants/` subdirectory**: Contains lists of words used by `handle-special-words.ts`:
    *   `acronyms.ts`: A list of common acronyms to be kept in uppercase.
    *   `articles.ts`: e.g., "a", "an", "the".
    *   `conjunctions.ts`: e.g., "and", "but", "or".
    *   `prepositions.ts`: A list of short prepositions (e.g., "of", "in", "on", "at").
    *   `special-case.ts`: Words that have a specific, fixed capitalization (e.g., "iPhone", "eBay").

## How It Works

The `formatTitle` function takes a string and an optional separator regex. It first decamelizes the input to handle inputs like `myExampleTitle`. Then, it splits the string into words using the specified separator (defaulting to spaces, hyphens, or underscores). Each word is then capitalized. Following this, the `handleSpecialWords` function iterates through the words, applying rules based on the lists in `constants/` to ensure proper title casing (e.g., acronyms remain uppercase, minor words like short prepositions are lowercased if not at the beginning or end of the title). Finally, the processed words are combined into the final title string.

## Usage Example

```typescript
import formatTitle from '@/helpers/format-title'; // Adjust path as needed
// or import { formatTitle } from '@/helpers/format-title';

console.log(formatTitle('hello world')); // Output: "Hello World"
console.log(formatTitle('hello-world-api')); // Output: "Hello World API"
console.log(formatTitle('myCustomTitle_for_THE_user')); // Output: "My Custom Title for the User" (actual output depends on specific rules in handleSpecialWords)
console.log(formatTitle('an_example_of_a_title')); // Output: "An Example of a Title"
console.log(formatTitle('what_is_an_api')); // Output: "What Is an API"

// Using a custom separator (if the default doesn't cover a case)
console.log(formatTitle('word1.word2.word3', new RegExp('\\.', 'g'))); // Output: "Word1 Word2 Word3"
```

This utility is useful for ensuring consistent and typographically correct titles across an application, especially when dealing with strings from various sources or in different initial formats. 