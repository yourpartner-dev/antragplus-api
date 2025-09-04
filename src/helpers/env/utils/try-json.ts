import { parseJSON } from '../../utils/index.js';

export const tryJson = (value: unknown) => {
	try {
		return parseJSON(String(value)) as unknown;
	} catch {
		return value;
	}
};
