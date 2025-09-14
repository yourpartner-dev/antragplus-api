import type { BaseCollectionMeta, DataCollectionMeta } from '../types.js';
import { loadYamlFile } from '../load-yaml.js';

const systemData = loadYamlFile('./collections/collections.yaml');
export const systemCollectionRows = (systemData['data'] as DataCollectionMeta[]).map(
	(row) =>
		({
			...(systemData['defaults'] as Partial<BaseCollectionMeta>),
			...row,
			system: true,
		}) as BaseCollectionMeta,
);

export const systemCollectionNames: string[] = (systemData['data'] as DataCollectionMeta[]).map(
	(row) => row['collection']!,
);

export function isSystemCollection(collection: string): boolean {
	return systemCollectionNames.includes(collection);
}
