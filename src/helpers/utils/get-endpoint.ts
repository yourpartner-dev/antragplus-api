import { isSystemCollection } from '../system-data/index.js';

export function getEndpoint(collection: string): string {
	if (isSystemCollection(collection)) {
		return `/${collection.substring(3)}`;
	}

	return `/items/${collection}`;
}
