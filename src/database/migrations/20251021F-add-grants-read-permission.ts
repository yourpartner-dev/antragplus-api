import type { Knex } from 'knex';
import { useEnv } from '../../helpers/env/index.js';

const env = useEnv();

export async function up(knex: Knex): Promise<void> {
	if (!env['ROLE_USER']) {
		throw new Error('ROLE_USER environment variable is not set');
	}

	await knex('yp_permissions').insert([
		// ============================================
		// grants - Read-only access to active grants
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'grants',
			action: 'read',
			permissions: JSON.stringify({
				status: { _eq: 'active' },
			}),
			fields: '*',
		},
	]);
}

export async function down(knex: Knex): Promise<void> {
	await knex('yp_permissions').where({ role: env['ROLE_USER'] }).where({ collection: 'grants' }).delete();
}
