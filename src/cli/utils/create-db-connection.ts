import knex from 'knex';
import type { Knex } from 'knex';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import type { Driver } from '../../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Credentials = {
	filename?: string;
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
	options__encrypt?: boolean;
};
export default function createDBConnection(client: Driver, credentials: Credentials): Knex<any, unknown[]> {
	let connection: any = {};

	const { host, port, database, user, password } = credentials as Credentials;

	connection = {
		host: host,
		port: Number(port),
		database: database,
		user: user,
		password: password,
	};

	const { ssl } = credentials as Credentials;
	connection.ssl = ssl;


	const knexConfig: Knex.Config = {
		client: client,
		connection: connection,
		seeds: {
			extension: 'js',
			directory: path.resolve(__dirname, '../../database/seeds/'),
		},
		pool: {},
	};

	const db = knex.default(knexConfig);
	return db;
}
