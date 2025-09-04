import type { YPError } from './create-error.js';
import type { ExtensionsMap } from './types.js';

/**
 * Check whether or not a passed value is a valid yourpartner error.
 *
 * @param value - Any value
 * @param code - Error code to check for
 */
export const isYPError = <T = never, C extends string = string>(
	value: unknown,
	code?: C,
): value is YPError<[T] extends [never] ? (C extends keyof ExtensionsMap ? ExtensionsMap[C] : unknown) : T> => {
	const isYPError =
		typeof value === 'object' &&
		value !== null &&
		Array.isArray(value) === false &&
		'name' in value &&
		value.name === 'YPError';

	if (code) {
		return isYPError && 'code' in value && value.code === code.toUpperCase();
	}

	return isYPError;
};
