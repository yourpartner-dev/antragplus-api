import type { Knex } from 'knex';
import { useEnv } from '../../helpers/env/index.js';

const env = useEnv();

export async function up(knex: Knex): Promise<void> {
	if (!env['ROLE_USER']) {
		throw new Error('ROLE_USER environment variable is not set');
	}

	await knex('yp_permissions').insert([
		// ============================================
		// ngo_project_ideas - Full CRUD via NGO's organization (DEEP FILTER)
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'ngo_project_ideas',
			action: 'create',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			presets: JSON.stringify({
				created_by: '$CURRENT_USER.id',
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'ngo_project_ideas',
			action: 'read',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'ngo_project_ideas',
			action: 'update',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'ngo_project_ideas',
			action: 'delete',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},
	]);
}

export async function down(knex: Knex): Promise<void> {
	await knex('yp_permissions').where({ role: env['ROLE_USER'] }).where({ collection: 'ngo_project_ideas' }).delete();
}
