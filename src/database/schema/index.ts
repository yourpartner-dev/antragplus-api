import type { Knex } from 'knex';
import type { SchemaInspectorConstructor } from './types/schema-inspector.js';

import PostgresSchemaInspector from './dialects/postgres.js';

export * from './types/column.js';
export * from './types/foreign-key.js';
export * from './types/table.js';
export * from './types/overview.js';
export * from './types/schema-inspector.js';

export const createInspector = (knex: Knex) => {
	let constructor: SchemaInspectorConstructor;
	
	switch (knex.client.constructor.name) {
		case 'Client_PG':
			constructor = PostgresSchemaInspector;
			break;
		
		default:
			throw Error('Unsupported driver used: ' + knex.client.constructor.name);
	}

	return new constructor(knex);
};
