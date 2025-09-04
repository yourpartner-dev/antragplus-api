import type { UnknownObject } from '../../types/index.js';

export function isObject(input: unknown): input is UnknownObject {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}
