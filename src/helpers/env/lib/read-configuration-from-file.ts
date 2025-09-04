import { JAVASCRIPT_FILE_EXTS } from '../../../constants.js';
import { isIn } from '../../utils/index.js';
import { existsSync } from 'node:fs';
import { getFileExtension } from '../utils/get-file-extension.js';
import { readConfigurationFromDotEnv } from '../utils/read-configuration-from-dotenv.js';
import { readConfigurationFromJavaScript } from '../utils/read-configuration-from-javascript.js';
import { readConfigurationFromJson } from '../utils/read-configuration-from-json.js';
import { readConfigurationFromYaml } from '../utils/read-configuration-from-yaml.js';

/**
 * Read configuration variables from config file
 */
export const readConfigurationFromFile = (path: string) => {
	if (existsSync(path) === false) {
		return null;
	}

	const ext = getFileExtension(path);

	if (isIn(ext, JAVASCRIPT_FILE_EXTS)) {
		return readConfigurationFromJavaScript(path);
	}

	if (ext === 'json') {
		return readConfigurationFromJson(path);
	}

	if (isIn(ext, ['yaml', 'yml'] as const)) {
		return readConfigurationFromYaml(path);
	}

	return readConfigurationFromDotEnv(path);
};
