import type { Knex } from 'knex';
import { useEnv } from '../../helpers/env/index.js';

const env = useEnv();

export async function up(knex: Knex): Promise<void> {
	if (!env['ROLE_USER']) {
		throw new Error('ROLE_USER environment variable is not set');
	}

	await knex('yp_permissions').insert([
		// ============================================
		// NGOs - Full CRUD access to own organization's NGOs
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'ngos',
			action: 'read',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'ngos',
			action: 'update',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*',
		},

		// ============================================
		// Applications - Access via NGO's organization
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'applications',
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
			collection: 'applications',
			action: 'update',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},

		// ============================================
		// yp_files - Organization files
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'yp_files',
			action: 'create',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			presets: JSON.stringify({
				organization_id: '$CURRENT_USER.organization_id',
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'yp_files',
			action: 'read',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'yp_files',
			action: 'update',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'yp_files',
			action: 'delete',
			permissions: JSON.stringify({
				organization_id: { _eq: '$CURRENT_USER.organization_id' },
			}),
			fields: '*',
		},

		// ============================================
		// yp_notifications - Own notifications only
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'yp_notifications',
			action: 'read',
			permissions: JSON.stringify({
				recipient: { _eq: '$CURRENT_USER.id' },
			}),
			fields: '*',
		},

		// ============================================
		// NGO Documents - Via NGO
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'ngo_documents',
			action: 'create',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},
		{
			role: env['ROLE_USER'],
			collection: 'ngo_documents',
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
			collection: 'ngo_documents',
			action: 'delete',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},

		// ============================================
		// NGO Snippets - Via NGO
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'ngo_snippets',
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
			collection: 'ngo_snippets',
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
			collection: 'ngo_snippets',
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
			collection: 'ngo_snippets',
			action: 'delete',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},

		// ============================================
		// Grant Matches - Read only
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'grant_matches',
			action: 'read',
			permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},

		// ============================================
		// Application Attachments - 2-level deep filtering
		// ============================================

		{
			role: env['ROLE_USER'],
			collection: 'application_attachments',
			action: 'read',
			permissions: JSON.stringify({
				application_id: {
					ngo_id: {
						organization_id: { _eq: '$CURRENT_USER.organization_id' },
					},
				},
			}),
			fields: '*',
		},


		// ============================================
		// Application Content - Via NGO or Application
		// ============================================
		{
			role: env['ROLE_USER'],
			collection: 'application_content',
			action: 'read',
				permissions: JSON.stringify({
				ngo_id: {
					organization_id: { _eq: '$CURRENT_USER.organization_id' },
				},
			}),
			fields: '*',
		},

		
		// ============================================
		// Application Content Versions
		// ============================================
		
		{
			role: env['ROLE_USER'],
			collection: 'application_content_versions',
			action: 'read',
			permissions: JSON.stringify({
				application_content_id: {
					application_id: {
						ngo_id: {
							organization_id: { _eq: '$CURRENT_USER.organization_id' },
						},
					},
				},
			}),
			fields: '*',
		},

	]);
}

export async function down(knex: Knex): Promise<void> {
	await knex('yp_permissions')
		.where({ role: env['ROLE_USER'] })
		.whereIn('collection', [
			'ngos',
			'applications',
			'yp_files',
			'yp_notifications',
			'ngo_documents',
			'ngo_snippets',
			'grant_matches',
			'application_attachments',
			'application_content',
			'application_content_versions',
		])
		.delete();
}
