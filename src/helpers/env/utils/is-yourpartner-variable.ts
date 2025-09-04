import { YP_VARIABLES_REGEX } from '../constants/yourpartner-variables.js';

export const isYourPartnerVariable = (key: string) => {
	if (key.endsWith('_FILE')) {
		key = key.slice(0, -5);
	}

	return YP_VARIABLES_REGEX.some((regex) => regex.test(key));
};
