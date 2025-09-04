import type { SchemaInspector } from './schema/index.js';
import { createInspector } from './schema/index.js';
import fse from 'fs-extra';
import type { Knex } from 'knex';
import knex from 'knex';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { performance } from 'perf_hooks';
import { useLogger } from '../helpers/logger/index.js';
import type { DatabaseClient } from '../types/index.js';
import { getConfigFromEnv } from '../helpers/utils/get-config-from-env.js';
import { validateEnv } from '../helpers/utils/validate-env.js';
import { getHelpers } from './helpers/index.js';

type QueryInfo = Partial<Knex.Sql> & {
	sql: Knex.Sql['sql'];
	__knexUid: string;
	__knexTxId: string;
	[key: string | number | symbol]: any;
};

let database: Knex | null = null;
let inspector: SchemaInspector | null = null;
let databaseVersion: string | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

export default getDatabase;

export function getDatabase(): Knex {
	if (database) {
		return database;
	}

	const logger = useLogger();

	const {
		client,
		version,
		searchPath,
		connectionString,
		pool: poolConfig = {},
		...connectionConfig
	} = getConfigFromEnv('DB_', ['DB_EXCLUDE_TABLES']);

	const requiredEnvVars = ['DB_CLIENT'];

	switch (client) {
		case 'pg':
			if (!connectionString) {
				requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER');
			} else {
				requiredEnvVars.push('DB_CONNECTION_STRING');
			}

			break;
		default:
			requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD');
	}

	validateEnv(requiredEnvVars);

	const knexConfig: Knex.Config = {
		client,
		version,
		searchPath,
		connection: connectionString || connectionConfig,
		log: {
			warn: (msg) => {
				// Ignore warnings about returning not being supported in some DBs
				if (msg.startsWith('.returning()')) return;
				if (msg.endsWith('does not currently support RETURNING clause')) return;

				// Ignore warning about MySQL not supporting TRX for DDL
				if (msg.startsWith('Transaction was implicitly committed, do not mix transactions and DDL with MySQL')) return;

				return logger.warn(msg);
			},
			error: (msg) => logger.error(msg),
			deprecate: (msg) => logger.info(msg),
			debug: (msg) => logger.debug(msg),
		},
		pool: poolConfig,
	};


	database = knex.default(knexConfig);

	const times = new Map<string, number>();

	database
		.on('query', ({ __knexUid }: QueryInfo) => {
			times.set(__knexUid, performance.now());
		})
		.on('query-response', (_response, queryInfo: QueryInfo) => {
			const time = times.get(queryInfo.__knexUid);
			let delta;

			if (time) {
				delta = performance.now() - time;
				times.delete(queryInfo.__knexUid);
			}

			logger.trace(`[${delta ? delta.toFixed(3) : '?'}ms] ${queryInfo.sql} [${(queryInfo.bindings ?? []).join(', ')}]`);
		});

	return database;
}

export function getSchemaInspector(): SchemaInspector {
	if (inspector) {
		return inspector;
	}

	const database = getDatabase();

	inspector = createInspector(database);

	return inspector;
}

/**
 * Get database version. Value currently exists for MySQL only.
 *
 * @returns Cached database version
 */
export function getDatabaseVersion(): string | null {
	return databaseVersion;
}

export async function hasDatabaseConnection(database?: Knex): Promise<boolean> {
	database = database ?? getDatabase();

	try {
		await database.raw('SELECT 1');
		return true;
	} catch {
		return false;
	}
}

export async function validateDatabaseConnection(database?: Knex): Promise<void> {
	database = database ?? getDatabase();
	const logger = useLogger();

	try {
		await database.raw('SELECT 1');
	} catch (error: any) {
		logger.error(`Can't connect to the database.`);
		logger.error(error);
		process.exit(1);
	}
}

export function getDatabaseClient(database?: Knex): DatabaseClient {
	database = database ?? getDatabase();

	return 'postgres';
}

export async function validateMigrations(): Promise<boolean> {
	const database = getDatabase();
	const logger = useLogger();

	try {
		let migrationFiles = await fse.readdir(path.join(__dirname, 'migrations'));

		migrationFiles = migrationFiles.filter(
			(file: string) => file.startsWith('run') === false && file.endsWith('.d.ts') === false,
		);

		const requiredVersions = migrationFiles.map((filePath) => filePath.split('-')[0]);

		const completedVersions = (await database.select('version').from('yp_migrations')).map(
			({ version }) => version,
		);

		return requiredVersions.every((version) => completedVersions.includes(version));
	} catch (error: any) {
		logger.error(`Database migrations cannot be found`);
		logger.error(error);
		throw process.exit(1);
	}
}

/**
 * These database extensions should be optional, so we don't throw or return any problem states when they don't
 */
export async function validateDatabaseExtensions(): Promise<void> {
	const database = getDatabase();
	const helpers = getHelpers(database);
	const geometrySupport = await helpers.st.supported();
	const logger = useLogger();

	if (!geometrySupport) {
		logger.warn(`PostGIS isn't installed. Geometry type support will be limited.`);
	}
}

export async function isInstalled(): Promise<boolean> {
	const inspector = getSchemaInspector();

	// The existence of a yp_users table alone isn't a "proper" check to see if everything
	// is installed correctly of course, but it's safe enough to assume that this collection only
	// exists when YP is properly installed.
	return await inspector.hasTable('yp_users');
}