import type { SchemaOverview } from '../../types/index.js';
import type { Knex } from 'knex';
import { getDatabaseClient } from '../index.js';

import * as dateHelpers from './date/index.js';
import * as fnHelpers from './fn/index.js';
import * as geometryHelpers from './geometry/index.js';
import * as schemaHelpers from './schema/index.js';
import * as sequenceHelpers from './sequence/index.js';
import * as numberHelpers from './number/index.js';

export function getHelpers(database: Knex) {
	const client = getDatabaseClient(database);

	return {
		date: new dateHelpers[client as keyof typeof dateHelpers](database),
		st: new geometryHelpers[client as keyof typeof geometryHelpers](database),
		schema: new schemaHelpers[client as keyof typeof  schemaHelpers](database),
		sequence: new sequenceHelpers[client as keyof typeof sequenceHelpers](database),
		number: new numberHelpers[client as keyof typeof  numberHelpers](database),
	};
}

export function getFunctions(database: Knex, schema: SchemaOverview) {
	const client = getDatabaseClient(database);
	return new fnHelpers[client as keyof typeof fnHelpers](database, schema);
}

export type Helpers = ReturnType<typeof getHelpers>;
