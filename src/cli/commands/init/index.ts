import chalk from 'chalk';
import { execa } from 'execa';
import inquirer from 'inquirer';
import Joi from 'joi';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import ora from 'ora';
import runMigrations from '../../../database/migrations/run.js';
import runSeed from '../../../database/seeds/run.js';
import { generateHash } from '../../../helpers/utils/generate-hash.js';
import type { Credentials } from '../../utils/create-db-connection.js';
import createDBConnection from '../../utils/create-db-connection.js';
import createEnv from '../../utils/create-env/index.js';
import { defaultAdminRole, defaultAdminUser } from '../../utils/defaults.js';
import { drivers, getDriverForClient } from '../../utils/drivers.js';
import { createPostgresDatabase } from '../../utils/postgres.js';
import { databaseQuestions } from './questions.js';

export default async function init(): Promise<void> {
	const rootPath = process.cwd();

	// Get project name first
	const { projectName } = await inquirer.prompt([
		{
			type: 'input',
			name: 'projectName',
			message: 'What is your project name?',
			default: 'my-yp-project',
			validate: (input: string) => {
				if (!input || input.trim().length === 0) {
					return 'Project name cannot be empty';
				}
				return true;
			},
		},
	]);

	const { client } = await inquirer.prompt([
		{
			type: 'list',
			name: 'client',
			message: 'Choose your database client',
			choices: Object.values(drivers),
		},
	]);

	const dbClient = getDriverForClient(client)!;

	const spinnerDriver = ora('Installing Database Driver...').start();
	await execa('pnpm', ['add', dbClient, '--prod']);
	spinnerDriver.stop();

	let attemptsRemaining = 5;

	const { credentials, db } = await trySeed();

	async function trySeed(): Promise<{ credentials: Credentials; db: Knex }> {
		const credentials: Credentials = await inquirer.prompt(
			(databaseQuestions[dbClient] as any[]).map((question: ({ client, filepath }: any) => any) =>
				question({ client: dbClient, filepath: rootPath }),
			),
		);

		// If PostgreSQL is selected, try to create the database
		if (dbClient === 'pg') {
			try {
				const databaseName = await createPostgresDatabase({
					host: credentials.host as string,
					port: credentials.port as number,
					user: credentials.user as string,
					password: credentials.password as string,
					database: credentials.database as string,
				}, projectName);

				// Update credentials with the generated database name
				credentials.database = databaseName;
			} catch (error: any) {
				process.stdout.write('\nFailed to create PostgreSQL database:\n');
				process.stdout.write(`\n${chalk.red(`[${error.code || 'Error'}]`)} ${error.message}\n`);
				process.stdout.write('\nPlease check your PostgreSQL credentials and try again\n\n');

				attemptsRemaining--;

				if (attemptsRemaining > 0) {
					return await trySeed();
				} else {
					process.stdout.write("Couldn't create the database. Exiting.\n");
					process.exit(1);
				}
			}
		}

		const db = createDBConnection(dbClient, credentials!);

		try {
			await runSeed(db);
			await runMigrations(db, 'latest', false);
		} catch (err: any) {
			process.stdout.write('\nSomething went wrong while seeding the database:\n');
			process.stdout.write(`\n${chalk.red(`[${err.code || 'Error'}]`)} ${err.message}\n`);
			process.stdout.write('\nPlease try again\n\n');

			attemptsRemaining--;

			if (attemptsRemaining > 0) {
				return await trySeed();
			} else {
				process.stdout.write("Couldn't seed the database. Exiting.\n");
				process.exit(1);
			}
		}

		return { credentials, db };
	}

	await createEnv(dbClient, credentials!, rootPath);

	process.stdout.write('\nCreate your first admin user:\n\n');

	const firstUser = await inquirer.prompt([
		{
			type: 'input',
			name: 'email',
			message: 'Email',
			default: 'admin@example.com',
			validate: (input: string) => {
				const emailSchema = Joi.string().email().required();
				const { error } = emailSchema.validate(input);
				if (error) throw new Error('The email entered is not a valid email address!');
				return true;
			},
		},
		{
			type: 'password',
			name: 'password',
			message: 'Password',
			mask: '*',
			validate: (input: string | null) => {
				if (input === null || input === '') throw new Error('The password cannot be empty!');
				return true;
			},
		},
	]);

	firstUser.password = await generateHash(firstUser.password);

	const userID = randomUUID();
	const roleID = randomUUID();

	await db('yp_roles').insert({
		id: roleID,
		...defaultAdminRole,
	});

	await db('yp_users').insert({
		id: userID,
		email: firstUser.email,
		password: firstUser.password,
		role: roleID,
		...defaultAdminUser,
	});

	await db.destroy();

	process.stdout.write(`\nYour project has been created at ${chalk.green(rootPath)}.\n`);
	process.stdout.write(`\nThe configuration can be found in ${chalk.green(rootPath + '/.env')}\n`);
	process.stdout.write(`\nStart YP by running:\n`);
	process.stdout.write(`  ${chalk.blue('cd')} ${rootPath}\n`);
	process.stdout.write(`  ${chalk.blue('pnpm dev')}\n`);

	process.exit(0);
}
