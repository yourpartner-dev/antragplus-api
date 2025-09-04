import getDatabase from '../../../database/index.js';
import { useLogger } from '../../../helpers/logger/index.js';
import { getSchema } from '../../../helpers/utils/get-schema.js';
import { UsersService } from '../../../services/users.js';

export default async function usersCreate({
	email,
	password,
	role,
}: {
	email?: string;
	password?: string;
	role?: string;
}): Promise<void> {
	const database = getDatabase();
	const logger = useLogger();

	if (!email || !password || !role) {
		logger.error('Email, password, role are required');
		process.exit(1);
	}

	try {
		const schema = await getSchema();
		const service = new UsersService({ schema, knex: database });

		const id = await service.createOne({ email, password, role, status: 'active' });
		process.stdout.write(`${String(id)}\n`);
		database.destroy();
		process.exit(0);
	} catch (err: any) {
		logger.error(err);
		process.exit(1);
	}
}
