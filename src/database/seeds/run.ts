import type { Field, Type } from '../../types/index.js';
import fse from 'fs-extra';
import yaml from 'js-yaml';
import type { Knex } from 'knex';
import { isObject } from 'lodash-es';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { getHelpers } from '../helpers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type TableSeed = {
	table: string;
	columns: {
		[column: string]: {
			type?: Type;
			primary?: boolean;
			nullable?: boolean;
			default?: any;
			length?: number;
			increments?: boolean;
			unsigned?: boolean;
			unique?: boolean;
			references?: {
				table: string;
				column: string;
				onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
				onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
			};
		};
	};
};

export default async function runSeed(database: Knex): Promise<void> {
	const helpers = getHelpers(database);

	// First, create the updated_at trigger function if it doesn't exist
	await database.raw(`
		CREATE OR REPLACE FUNCTION update_updated_at_column()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$ language 'plpgsql';
	`);

	const tableSeeds = await fse.readdir(path.resolve(__dirname));

	for (const tableSeedFile of tableSeeds) {
		if (tableSeedFile.startsWith('run')) continue;

		const yamlRaw = await fse.readFile(path.resolve(__dirname, tableSeedFile), 'utf8');

		const seedData = yaml.load(yamlRaw) as TableSeed;

		// Check if table exists before creating it
		const tableExists = await database.schema.hasTable(seedData.table);
		if (tableExists) {
			console.log(`Table ${seedData.table} already exists, skipping...`);
			continue;
		}

		let hasUpdatedAt = false;

		await database.schema.createTable(seedData.table, (tableBuilder) => {
			for (const [columnName, columnInfo] of Object.entries(seedData.columns)) {
				let column: Knex.ColumnBuilder;

				if (columnInfo.type === 'alias' || columnInfo.type === 'unknown') return;

				// Track if this table has an updated_at column
				if (columnName === 'updated_at') {
					hasUpdatedAt = true;
				}

				if (columnInfo.type === 'string') {
					column = tableBuilder.string(columnName, columnInfo.length);
				} else if (columnInfo.increments) {
					column = tableBuilder.increments();
				} else if (columnInfo.type === 'csv') {
					column = tableBuilder.text(columnName);
				} else if (columnInfo.type === 'hash') {
					column = tableBuilder.string(columnName, 255);
				} else if (columnInfo.type?.startsWith('geometry')) {
					column = helpers.st.createColumn(tableBuilder, { field: columnName, type: columnInfo.type } as Field);
				} else {
					// @ts-ignore
					column = tableBuilder[columnInfo.type!](columnName);
				}

				if (columnInfo.primary) {
					column.primary();
				}

				if (columnInfo.nullable !== undefined && columnInfo.nullable === false) {
					column.notNullable();
				}

				// Auto-add UUID generation for UUID primary keys
				if (columnInfo.type === 'uuid' && columnInfo.primary && columnInfo.default === undefined) {
					column.defaultTo(database.raw('gen_random_uuid()'));
				}

				// Auto-add defaults for common timestamp fields
				if (columnInfo.type === 'timestamp' && columnInfo.default === undefined) {
					// created_at and date_created should default to CURRENT_TIMESTAMP
					if (columnName === 'created_at' || columnName === 'date_created') {
						column.defaultTo(database.fn.now());
					}
					// updated_at should also default to CURRENT_TIMESTAMP (will be updated by triggers)
					if (columnName === 'updated_at') {
						column.defaultTo(database.fn.now());
					}
				}

				// Handle explicit defaults
				if (columnInfo.default !== undefined) {
					let defaultValue = columnInfo.default;

					if (isObject(defaultValue) || Array.isArray(defaultValue)) {
						defaultValue = JSON.stringify(defaultValue);
					}

					if (defaultValue === '$now') {
						defaultValue = database!.fn.now();
					}

					column.defaultTo(defaultValue);
				}

				if (columnInfo.unique) {
					column.unique();
				}

				if (columnInfo.unsigned) {
					column.unsigned();
				}

				if (columnInfo.references) {
					const ref = column.references(columnInfo.references.column).inTable(columnInfo.references.table);
					if (columnInfo.references.onDelete) ref.onDelete(columnInfo.references.onDelete);
					if (columnInfo.references.onUpdate) ref.onUpdate(columnInfo.references.onUpdate);
				}
			}
		});

		// If the table has an updated_at column, create a trigger to automatically update it
		if (hasUpdatedAt) {
			await database.raw(`
				CREATE TRIGGER update_${seedData.table}_updated_at 
				BEFORE UPDATE ON ${seedData.table}
				FOR EACH ROW 
				EXECUTE FUNCTION update_updated_at_column();
			`);
		}
	}
}
