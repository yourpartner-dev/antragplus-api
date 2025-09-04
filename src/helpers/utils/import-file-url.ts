import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathToRelativeUrl } from './node/path-to-relative-url.js';

interface ImportOptions {
	fresh?: boolean;
}

export function importFileUrl(url: string, root: string, options: ImportOptions = {}): Promise<any> {
	return import(`./${pathToRelativeUrl(url, dirname(fileURLToPath(root)))}${options.fresh ? `?t=${Date.now()}` : ''}`);
}
