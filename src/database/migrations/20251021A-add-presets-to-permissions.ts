import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('yp_permissions', (table) => {
		table.json('presets').nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('yp_permissions', (table) => {
		table.dropColumn('presets');
	});
}
