import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('custom_prompts', (table) => {
		// Primary key with auto-generated UUID
		table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

		// Prompt name
		table.string('name', 255).notNullable();

		// Prompt content (from textarea)
		table.text('content');

		// Audit fields
		table.uuid('created_by');
		table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
		table.uuid('updated_by');
		table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

		// Flexible metadata for additional information
		table.jsonb('metadata').defaultTo('{}');
	});

	// Create indexes for performance
	await knex.raw(`
		CREATE INDEX idx_custom_prompts_created_by ON custom_prompts(created_by);
		CREATE INDEX idx_custom_prompts_created_at ON custom_prompts(created_at DESC);
	`);

	// Add update trigger for updated_at
	await knex.raw(`
		CREATE TRIGGER update_custom_prompts_updated_at
		BEFORE UPDATE ON custom_prompts
		FOR EACH ROW
		EXECUTE FUNCTION update_updated_at_column();
	`);
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('custom_prompts');
}
