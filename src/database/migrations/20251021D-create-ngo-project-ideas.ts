import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('ngo_project_ideas', (table) => {
		// Primary key with auto-generated UUID
		table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

		// Foreign key to NGOs with CASCADE DELETE
		table
			.uuid('ngo_id')
			.notNullable()
			.references('id')
			.inTable('ngos')
			.onDelete('CASCADE');

		// Title for the project idea
		table.string('title', 255);

		// BlockNote content stored as JSONB
		table.jsonb('content').defaultTo('{}');

		// Status for tracking idea progress
		table.string('status', 50).defaultTo('draft'); // draft, active, archived, implemented

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
		CREATE INDEX idx_ngo_project_ideas_ngo_id ON ngo_project_ideas(ngo_id);
		CREATE INDEX idx_ngo_project_ideas_status ON ngo_project_ideas(status);
		CREATE INDEX idx_ngo_project_ideas_created_at ON ngo_project_ideas(created_at DESC);
		CREATE INDEX idx_ngo_project_ideas_created_by ON ngo_project_ideas(created_by);
	`);

	// Add update trigger for updated_at
	await knex.raw(`
		CREATE TRIGGER update_ngo_project_ideas_updated_at
		BEFORE UPDATE ON ngo_project_ideas
		FOR EACH ROW
		EXECUTE FUNCTION update_updated_at_column();
	`);
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('ngo_project_ideas');
}
