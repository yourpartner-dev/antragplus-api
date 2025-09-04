import { requireYaml } from '../../utils/node/index.js';
import { isPlainObject } from 'lodash-es';

export const readConfigurationFromYaml = (path: string) => {
	const config = requireYaml(path);

	if (isPlainObject(config) === false) {
		throw new Error('YAML configuration file does not contain an object');
	}

	return config as Record<string, unknown>;
};
