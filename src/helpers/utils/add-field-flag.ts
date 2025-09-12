import type { RawField } from '../../types/index.js';

/**
 * Add a special flag to a field's metadata
 * @param field - The field to add the flag to
 * @param flag - The flag to add
 */
export function addFieldFlag(field: RawField, flag: string): void {
	if (!field.meta) {
		field.meta = { special: [flag] };
		return;
	}

	if (!field.meta.special || field.meta.special === null) {
		field.meta.special = [flag];
		return;
	}

	if (!field.meta.special.includes(flag)) {
		field.meta.special.push(flag);
	}
}