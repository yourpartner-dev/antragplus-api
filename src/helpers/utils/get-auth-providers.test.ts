import { useEnv } from '../../helpers/env/index.js';
import { describe, expect, test, vi } from 'vitest';
import { getAuthProviders } from './get-auth-providers.js';

vi.mock('../../helpers/env/index.js');

const scenarios = [
	{
		name: 'when no providers configured',
		input: {},
		output: [],
	},
	{
		name: 'when no driver configured',
		input: {
			AUTH_PROVIDERS: 'yourpartner',
		},
		output: [],
	},

	{
		name: 'when single provider and driver are properly configured',
		input: {
			AUTH_PROVIDERS: 'yourpartner',
			AUTH_yp_DRIVER: 'openid',
			AUTH_yp_LABEL: 'yourpartner',
			AUTH_yp_ICON: 'hare',
		},
		output: [
			{
				name: 'yourpartner',
				driver: 'openid',
				label: 'yourpartner',
				icon: 'hare',
			},
		],
	},

	{
		name: 'when multiple provider and driver are properly configured',
		input: {
			AUTH_PROVIDERS: 'yourpartner,custom',
			AUTH_yp_DRIVER: 'openid',
			AUTH_yp_LABEL: 'yourpartner',
			AUTH_yp_ICON: 'hare',
			AUTH_CUSTOM_DRIVER: 'openid',
			AUTH_CUSTOM_ICON: 'lock',
		},
		output: [
			{
				name: 'yourpartner',
				driver: 'openid',
				label: 'yourpartner',
				icon: 'hare',
			},
			{
				name: 'custom',
				driver: 'openid',
				icon: 'lock',
			},
		],
	},
];

describe('get auth providers', () => {
	for (const scenario of scenarios) {
		test(scenario.name, () => {
			vi.mocked(useEnv).mockReturnValue(scenario.input);

			expect(getAuthProviders()).toEqual(scenario.output);
		});
	}
});
