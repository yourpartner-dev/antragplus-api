import type { Knex } from 'knex';
import { useEnv } from '../../helpers/env/index.js';

const env = useEnv();

export async function up(knex: Knex): Promise<void> {
	if (!env['ROLE_USER']) {
		throw new Error('ROLE_USER environment variable is not set');
	}

	await knex('yp_permissions').insert([
		// ============================================
		// yp_users - Own profile access (READ + UPDATE)
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'yp_users',
			action: 'read',
			permissions: JSON.stringify({
				id: { _eq: '$CURRENT_USER.id' },
			}),
			// Exclude sensitive fields: password, tfa_secret, token, auth_data
			fields: 'id,first_name,role,last_name,email,title,description,tags,avatar,language,theme,status,last_access,last_page,created_at,email_notifications,provider,external_identifier,metadata,organization_id',
		},
		{
			role: env['ROLE_USER'],
			collection: 'yp_users',
			action: 'update',
			permissions: JSON.stringify({
				id: { _eq: '$CURRENT_USER.id' },
			}),
			// Allow updating profile fields, but NOT: id, email, password, tfa_secret, token, auth_data, role, status, organization_id, provider, external_identifier
			fields: 'first_name,last_name,title,description,tags,avatar,language,theme,email_notifications,metadata',
		},

		// ============================================
		// yp_organizations - Read-only access to own org
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'yp_organizations',
			action: 'read',
			permissions: JSON.stringify({
				id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*', // All fields accessible for reading
		},
		{
			role: env['ROLE_USER'],
			collection: 'yp_organizations',
			action: 'update',
			permissions: JSON.stringify({
				id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*', // All fields accessible for reading
		},
	]);
}

export async function down(knex: Knex): Promise<void> {
	await knex('yp_permissions')
		.where({ role: env['ROLE_USER'] })
		.whereIn('collection', ['yp_users', 'yp_organizations'])
		.delete();
}
