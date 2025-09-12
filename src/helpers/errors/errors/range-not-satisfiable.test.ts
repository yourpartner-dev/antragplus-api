import { randomInteger } from '../../random/index.js';
import { expect, test } from 'vitest';
import { messageConstructor } from './range-not-satisfiable.js';

type Range = { start: number; end: number };

let range: Range;

test('Constructs message with given range', () => {
	range = {
		start: randomInteger(0, 2500),
		end: randomInteger(2501, 5000),
	};

	expect(messageConstructor({ range })).toBe(
		`Range "${range.start}-${range.end}" is invalid or the file's size doesn't match the requested range.`,
	);
});
