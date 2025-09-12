import { expect, test } from 'vitest';
import { parseFilterKey } from './parse-filter-key.js';

const testCases = [
	{ key: 'test', expected: { fieldName: 'test' } },
	{ key: ' ', expected: { fieldName: '' } },
	// should only treat as function when field available
	{ key: 'fn( )', expected: { fieldName: 'fn( )' } },
	{ key: 'year(created_at)', expected: { fieldName: 'created_at', functionName: 'year' } },
	{ key: ' example ( field )', expected: { fieldName: 'field', functionName: 'example' } },
];

test.each(testCases)('should return "$expected" for "$key"', ({ key, expected }) => {
	const { fieldName, functionName } = parseFilterKey(key);

	expect(fieldName).toBe(expected.fieldName);
	expect(functionName).toBe(expected.functionName);
});
