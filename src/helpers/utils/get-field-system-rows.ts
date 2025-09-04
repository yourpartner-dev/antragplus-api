import type { FieldMeta } from '../../types/index.js';
import { systemFieldRows } from '../system-data/index.js';
import formatTitle from '../format-title/index.js';
import { getAuthProviders } from './get-auth-providers.js';

// Dynamically populate auth providers field
export function getSystemFieldRowsWithAuthProviders(): FieldMeta[] {
	return systemFieldRows.map((systemField) => {
		if (systemField.collection === 'yp_users' && systemField.field === 'provider') {
			if (!systemField.options) systemField.options = {};

			systemField.options['choices'] = getAuthProviders().map(({ name }) => ({
				text: formatTitle(name),
				value: name,
			}));
		}

		return systemField;
	});
}
