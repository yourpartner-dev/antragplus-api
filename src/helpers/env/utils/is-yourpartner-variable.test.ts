import { expect, test, vi } from 'vitest';
import { isYourPartnerVariable } from './is-yourpartner-variable.js';

vi.mock('../constants/yourpartner-variables.js', () => ({
	YP_VARIABLES_REGEX: [/TEST_.*/],
}));

test('Returns false if variable matches none of the regexes', () => {
	expect(isYourPartnerVariable('NO')).toBe(false);
});

test('Returns true if variable matches one or more of the regexes', () => {
	expect(isYourPartnerVariable('TEST_123')).toBe(true);
});

test('Checks against original name if variable is suffixed with _FILE', () => {
	expect(isYourPartnerVariable('NO_FILE')).toBe(false);
	expect(isYourPartnerVariable('TEST_123_FILE')).toBe(true);
});
