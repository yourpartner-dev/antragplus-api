import getDatabase, { getDatabaseClient } from '../index.js';
import emitter from '../../emitter.js';
import { extractError as postgres } from './dialects/postgres.js';
import type { SQLError } from './dialects/types.js';

/**
 * Translates an error thrown by any of the databases into a pre-defined Exception. Currently
 * supports:
 * - Invalid Foreign Key
 * - Not Null Violation
 * - Record Not Unique
 * - Value Out of Range
 * - Value Too Long
 */
export async function translateDatabaseError(error: SQLError): Promise<any> {
	const client = getDatabaseClient();
	let defaultError: any;

	defaultError = postgres(error);

	const hookError = await emitter.emitFilter(
		'database.error',
		defaultError,
		{ client },
		{
			database: getDatabase(),
			schema: null,
			accountability: null,
		},
	);

	return hookError;
}
