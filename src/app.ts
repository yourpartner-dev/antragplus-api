import { useEnv } from './helpers/env/index.js';
import { InvalidPayloadError, ServiceUnavailableError } from './helpers/errors/index.js';
import { handlePressure } from './helpers/pressure/index.js';
import cookieParser from 'cookie-parser';
import type { RequestHandler } from 'express';
import express from 'express';
import { merge } from 'lodash-es';
import qs from 'qs';
import { registerAuthProviders } from './auth.js';
import activityRouter from './controllers/activity.js';
import assetsRouter from './controllers/assets.js';
import authRouter from './controllers/auth.js';
import filesRouter from './controllers/files.js';
import foldersRouter from './controllers/folders.js';
import itemsRouter from './controllers/items.js';
import notFoundHandler from './controllers/not-found.js';
import notificationsRouter from './controllers/notifications.js';
import permissionsRouter from './controllers/permissions.js';
import revisionsRouter from './controllers/revisions.js';
import rolesRouter from './controllers/roles.js';
import serverRouter from './controllers/server.js';
import usersRouter from './controllers/users.js';
import utilsRouter from './controllers/utils.js';
import graphqlRouter from './controllers/graphql.js';
import tusRouter from './controllers/tus.js';
import 	{
	validateDatabaseConnection,
	validateDatabaseExtensions,
	validateMigrations,
} from './database/index.js';
import emitter from './emitter.js';
import { createExpressLogger, useLogger } from './helpers/logger/index.js';
import authenticate from './middleware/authenticate.js';
import cache from './middleware/cache.js';
import { checkIP } from './middleware/check-ip.js';
import cors from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import extractToken from './middleware/extract-token.js';
import getPermissions from './middleware/get-permissions.js';
import rateLimiterGlobal from './middleware/rate-limiter-global.js';
import rateLimiter from './middleware/rate-limiter-ip.js';
import sanitizeQuery from './middleware/sanitize-query.js';
import schema from './middleware/schema.js';
import { getConfigFromEnv } from './helpers/utils/get-config-from-env.js';
import { Url } from './helpers/utils/url.js';
import { validateStorage } from './helpers/utils/validate-storage.js';

//Import all hooks here if any
import './hooks/index.js';

//Import all schedulers here if any

export default async function createApp(): Promise<express.Application> {
	const env = useEnv();
	const logger = useLogger();
	const helmet = await import('helmet');

	await validateDatabaseConnection();

	if ((await validateMigrations()) === false) {
		logger.warn(`Database migrations have not all been run`);
	}

	if (!env['SECRET']) {
		logger.warn(
			`"SECRET" env variable is missing. Using a random value instead. Tokens will not persist between restarts. This is not appropriate for production usage.`,
		);
	}

	if (!new Url(env['PUBLIC_URL'] as string).isAbsolute()) {
		logger.warn('"PUBLIC_URL" should be a full URL');
	}

	await validateDatabaseExtensions();
	await validateStorage();

	await registerAuthProviders();
	

	const app = express();

	app.disable('x-powered-by');
	app.set('trust proxy', env['IP_TRUST_PROXY']);
	app.set('query parser', (str: string) => qs.parse(str, { depth: 10 }));

	if (env['PRESSURE_LIMITER_ENABLED']) {
		const sampleInterval = Number(env['PRESSURE_LIMITER_SAMPLE_INTERVAL']);

		if (Number.isNaN(sampleInterval) === true || Number.isFinite(sampleInterval) === false) {
			throw new Error(`Invalid value for PRESSURE_LIMITER_SAMPLE_INTERVAL environment variable`);
		}

		app.use(
			handlePressure({
				sampleInterval,
				maxEventLoopUtilization: env['PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION'] as number,
				maxEventLoopDelay: env['PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY'] as number,
				maxMemoryRss: env['PRESSURE_LIMITER_MAX_MEMORY_RSS'] as number,
				maxMemoryHeapUsed: env['PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED'] as number,
				error: new ServiceUnavailableError({ service: 'api', reason: 'Under pressure' }),
				retryAfter: env['PRESSURE_LIMITER_RETRY_AFTER'] as string,
			}),
		);
	}

	app.use(
		helmet.contentSecurityPolicy(
			merge(
				{
					useDefaults: true,
					directives: {
						// Unsafe-eval is required for app extensions
						scriptSrc: ["'self'", "'unsafe-eval'"],

						// Even though this is recommended to have enabled, it breaks most local
						// installations. Making this opt-in rather than opt-out is a little more
						// friendly. Ref #10806
						upgradeInsecureRequests: null,

						// These are required for MapLibre
						workerSrc: ["'self'", 'blob:'],
						childSrc: ["'self'", 'blob:'],
						imgSrc: [
							"'self'",
							'data:',
							'blob:',
							'https://raw.githubusercontent.com',
							'https://avatars.githubusercontent.com',
						],
						mediaSrc: ["'self'"],
						connectSrc: ["'self'", 'https://*'],
					},
				},
				getConfigFromEnv('CONTENT_SECURITY_POLICY_'),
			),
		),
	);

	if (env['HSTS_ENABLED']) {
		app.use(helmet.hsts(getConfigFromEnv('HSTS_', ['HSTS_ENABLED'])));
	}

	await emitter.emitInit('app.before', { app });

	await emitter.emitInit('middlewares.before', { app });

	app.use(createExpressLogger());

	app.use((_req, res, next) => {
		res.setHeader('X-Powered-By', 'YP');
		next();
	});

	if (env['CORS_ENABLED'] === true) {
		app.use(cors);
	}

	app.use((req, res, next) => {
		(
			express.json({
				limit: env['MAX_PAYLOAD_SIZE'] as string,
			}) as RequestHandler
		)(req, res, (err: any) => {
			if (err) {
				return next(new InvalidPayloadError({ reason: err.message }));
			}

			return next();
		});
	});

	app.use(cookieParser());

	app.use(extractToken);

	app.get('/', (_req, res, next) => {
		if (env['ROOT_REDIRECT']) {
			res.redirect(env['ROOT_REDIRECT'] as string);
		} else {
			next();
		}
	});

	app.get('/robots.txt', (_, res) => {
		res.set('Content-Type', 'text/plain');
		res.status(200);
		res.send(env['ROBOTS_TXT']);
	});

	// use the rate limiter - all routes for now
	if (env['RATE_LIMITER_GLOBAL_ENABLED'] === true) {
		app.use(rateLimiterGlobal);
	}

	if (env['RATE_LIMITER_ENABLED'] === true) {
		app.use(rateLimiter);
	}

	app.get('/server/ping', (_req, res) => res.send('pong'));

	app.use(authenticate);

	app.use(checkIP);

	app.use(sanitizeQuery);

	app.use(cache);

	app.use(schema);

	app.use(getPermissions);

	await emitter.emitInit('middlewares.after', { app });

	await emitter.emitInit('routes.before', { app });

	app.use('/auth', authRouter);

	app.use('/graphql', graphqlRouter);

	app.use('/activity', activityRouter);
	app.use('/assets', assetsRouter);


	if (env['TUS_ENABLED'] === true) {
		app.use('/files/tus', tusRouter);
	}

	app.use('/files', filesRouter);
	app.use('/folders', foldersRouter);
	app.use('/items', itemsRouter);
	app.use('/notifications', notificationsRouter);
	app.use('/permissions', permissionsRouter);
	app.use('/revisions', revisionsRouter);

	app.use('/roles', rolesRouter);
	app.use('/server', serverRouter);
	app.use('/users', usersRouter);
	app.use('/utils', utilsRouter);


	app.use(notFoundHandler);
	app.use(errorHandler);

	await emitter.emitInit('routes.after', { app });

	//scheduleTusCleanup();

	await emitter.emitInit('app.after', { app });

	return app;
}
