import { RelationMeta } from '../types.js';
import { loadYamlFile } from '../load-yaml.js';

const systemData = loadYamlFile('./relations/relations.yaml');

export const systemRelationRows = (systemData['data'] as RelationMeta[]).map(
	(row) =>
		({
			...(systemData['defaults'] as Partial<RelationMeta>),
			...row,
			system: true,
		}) as RelationMeta,
);
