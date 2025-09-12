import {
	ErrorCode,
	ForbiddenError,
	InvalidCredentialsError,
	InvalidPayloadError,
	InvalidTokenError,
	isYPError,
} from '../helpers/errors/index.js';
import type { PrimaryKey, RegisterUserInput, Role } from '../types/index.js';
import express from 'express';
import Joi from 'joi';
import checkRateLimit from '../middleware/rate-limiter-registration.js';
import { respond } from '../middleware/respond.js';
import useCollection from '../middleware/use-collection.js';
import { validateBatch } from '../middleware/validate-batch.js';
import { AuthenticationService } from '../services/authentication.js';
import { MetaService } from '../services/meta.js';
import { RolesService } from '../services/roles.js';
import { TFAService } from '../services/tfa.js';
import { UsersService } from '../services/users.js';
import asyncHandler from '../helpers/utils/async-handler.js';
import { sanitizeQuery } from '../helpers/utils/sanitize-query.js';
import { useLogger } from '../helpers/logger/index.js';
import { toLowerCase } from '../helpers/utils/to-lower-case.js';

const router = express.Router();
const logger = useLogger();

router.use(useCollection('yp_users'));

router.post(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const savedKeys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			const keys = await service.createMany(req.body);
			savedKeys.push(...keys);
		} else {
			const key = await service.createOne(req.body);
			savedKeys.push(key);
		}

		try {
			if (Array.isArray(req.body)) {
				const items = await service.readMany(savedKeys, req.sanitizedQuery);
				res.locals['payload'] = { data: items };
			} else {
				const item = await service.readOne(savedKeys[0]!, req.sanitizedQuery);
				res.locals['payload'] = { data: item };
			}
		} catch (error: any) {
			if (isYPError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

const readHandler = asyncHandler(async (req, res, next) => {
	const service = new UsersService({
		accountability: req.accountability,
		schema: req.schema,
	});

	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema,
	});

	const item = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery('yp_users', req.sanitizedQuery);

	res.locals['payload'] = { data: item || null, meta };
	return next();
});

router.get('/', validateBatch('read'), readHandler, respond);
router.search('/', validateBatch('read'), readHandler, respond);

router.get(
	'/me',
	asyncHandler(async (req, res, next) => {
		if (req.accountability?.share_scope) {
			const user = {
				share: req.accountability?.share,
				role: {
					id: req.accountability.role,
					admin_access: false,
					app_access: false,
				},
			};

			res.locals['payload'] = { data: user };
			return next();
		}

		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		try {
			const item = await service.readOne(req.accountability.user, req.sanitizedQuery);
			res.locals['payload'] = { data: item || null };
		} catch (error: any) {
			if (isYPError(error, ErrorCode.Forbidden)) {
				res.locals['payload'] = { data: { id: req.accountability.user } };
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.get(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		if (req.path.endsWith('me')) return next();

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const items = await service.readOne(req.params['pk']!, req.sanitizedQuery);

		res.locals['payload'] = { data: items || null };
		return next();
	}),
	respond,
);

router.patch(
	'/me',
	asyncHandler(async (req, res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const primaryKey = await service.updateOne(req.accountability.user, req.body);
		const item = await service.readOne(primaryKey, req.sanitizedQuery);

		res.locals['payload'] = { data: item || null };
		return next();
	}),
	respond,
);

router.patch(
	'/me/track/page',
	asyncHandler(async (req, _res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		if (!req.body.last_page) {
			throw new InvalidPayloadError({ reason: `"last_page" key is required` });
		}

		const service = new UsersService({ schema: req.schema });
		await service.updateOne(req.accountability.user, { last_page: req.body.last_page }, { autoPurgeCache: false });

		return next();
	}),
	respond,
);

router.patch(
	'/',
	validateBatch('update'),
	asyncHandler(async (req, res, next) => {
		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let keys: PrimaryKey[] = [];

		if (Array.isArray(req.body)) {
			keys = await service.updateBatch(req.body);
		} else if (req.body.keys) {
			keys = await service.updateMany(req.body.keys, req.body.data);
		} else {
			const sanitizedQuery = sanitizeQuery(req.body.query, req.accountability);
			keys = await service.updateByQuery(sanitizedQuery, req.body.data);
		}

		try {
			const result = await service.readMany(keys, req.sanitizedQuery);
			res.locals['payload'] = { data: result };
		} catch (error: any) {
			if (isYPError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.patch(
	'/:pk',
	asyncHandler(async (req, res, next) => {
		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const primaryKey = await service.updateOne(req.params['pk']!, req.body);

		try {
			const item = await service.readOne(primaryKey, req.sanitizedQuery);
			res.locals['payload'] = { data: item || null };
		} catch (error: any) {
			if (isYPError(error, ErrorCode.Forbidden)) {
				return next();
			}

			throw error;
		}

		return next();
	}),
	respond,
);

router.delete(
	'/',
	validateBatch('delete'),
	asyncHandler(async (req, _res, next) => {
		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		if (Array.isArray(req.body)) {
			await service.deleteMany(req.body);
		} else if (req.body.keys) {
			await service.deleteMany(req.body.keys);
		} else {
			const sanitizedQuery = sanitizeQuery(req.body.query, req.accountability);
			await service.deleteByQuery(sanitizedQuery);
		}

		return next();
	}),
	respond,
);

router.delete(
	'/:pk',
	asyncHandler(async (req, _res, next) => {
		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.deleteOne(req.params['pk']!);

		return next();
	}),
	respond,
);

const inviteSchema = Joi.object({
	email: Joi.alternatives(Joi.string().email(), Joi.array().items(Joi.string().email())).required(),
	role: Joi.string().uuid({ version: 'uuidv4' }).required(),
	invite_url: Joi.string().uri(),
	params: Joi.object(),
});

router.post(
	'/invite',
	asyncHandler(async (req, res, next) => {
		const { error } = inviteSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});
		//Double checking that all emails are lowercase
		const users = await service.inviteUser(toLowerCase(req.body.email), req.body.role, req.body.invite_url || null, req.body.subject || null, req.body.params || null);
		res.locals['payload'] = { data: users };
		return next();
	}),
	respond,
);

const acceptInviteSchema = Joi.object({
	token: Joi.string().required(),
	password: Joi.string().required(),
	email: Joi.string().required(),
});

router.post(
	'/invite/accept',
	asyncHandler(async (req, _res, next) => {
		const { error } = acceptInviteSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.acceptInvite(req.body.token, req.body.password, req.body.email);
		return next();
	}),
	respond,
);

router.post(
	'/me/tfa/generate/',
	asyncHandler(async (req, res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		if (!req.body.password) {
			throw new InvalidPayloadError({ reason: `"password" is required` });
		}

		const service = new TFAService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const authService = new AuthenticationService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await authService.verifyPassword(req.accountability.user, req.body.password);

		const { url, secret } = await service.generateTFA(req.accountability.user);

		res.locals['payload'] = { data: { secret, otpauth_url: url } };
		return next();
	}),
	respond,
);

router.post(
	'/me/tfa/enable/',
	asyncHandler(async (req, _res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		if (!req.body.secret) {
			throw new InvalidPayloadError({ reason: `"secret" is required` });
		}

		if (!req.body.otp) {
			throw new InvalidPayloadError({ reason: `"otp" is required` });
		}

		// Override permissions only when enforce TFA is enabled in role
		if (req.accountability.role) {
			const rolesService = new RolesService({
				schema: req.schema,
			});

			const role = (await rolesService.readOne(req.accountability.role)) as Role;

			if (role && role.enforce_tfa) {
				const existingPermission = await req.accountability.permissions?.find(
					(p: any) => p.collection === 'yp_users' && p.action === 'update',
				);

				if (existingPermission) {
					existingPermission.fields = ['tfa_secret'];
					existingPermission.permissions = { id: { _eq: req.accountability.user } };
					existingPermission.presets = null;
					existingPermission.validation = null;
				} else {
					(req.accountability.permissions || (req.accountability.permissions = [])).push({
						action: 'update',
						collection: 'yp_users',
						fields: ['tfa_secret'],
						permissions: { id: { _eq: req.accountability.user } },
						presets: null,
						role: req.accountability.role,
						validation: null,
					});
				}
			}
		}

		const service = new TFAService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.enableTFA(req.accountability.user, req.body.otp, req.body.secret);

		return next();
	}),
	respond,
);

router.post(
	'/me/tfa/disable',
	asyncHandler(async (req, _res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		if (!req.body.otp) {
			throw new InvalidPayloadError({ reason: `"otp" is required` });
		}

		// Override permissions only when enforce TFA is enabled in role
		if (req.accountability.role) {
			const rolesService = new RolesService({
				schema: req.schema,
			});

			const role = (await rolesService.readOne(req.accountability.role)) as Role;

			if (role && role.enforce_tfa) {
				const existingPermission = await req.accountability.permissions?.find(
					(p: any) => p.collection === 'yp_users' && p.action === 'update',
				);

				if (existingPermission) {
					existingPermission.fields = ['tfa_secret'];
					existingPermission.permissions = { id: { _eq: req.accountability.user } };
					existingPermission.presets = null;
					existingPermission.validation = null;
				} else {
					(req.accountability.permissions || (req.accountability.permissions = [])).push({
						action: 'update',
						collection: 'yp_users',
						fields: ['tfa_secret'],
						permissions: { id: { _eq: req.accountability.user } },
						presets: null,
						role: req.accountability.role,
						validation: null,
					});
				}
			}
		}

		const service = new TFAService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const otpValid = await service.verifyOTP(req.accountability.user, req.body.otp);

		if (otpValid === false) {
			throw new InvalidPayloadError({ reason: `"otp" is invalid` });
		}

		await service.disableTFA(req.accountability.user);
		return next();
	}),
	respond,
);

router.post(
	'/:pk/tfa/disable',
	asyncHandler(async (req, _res, next) => {
		if (!req.accountability?.user) {
			throw new InvalidCredentialsError();
		}

		if (!req.accountability.admin || !req.params['pk']) {
			throw new ForbiddenError();
		}

		const service = new TFAService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.disableTFA(req.params['pk']);
		return next();
	}),
	respond,
);

const registerSchema = Joi.object<RegisterUserInput>({
	email: Joi.string().email().required(),
	password: Joi.string().required(),
	user_id: Joi.string().uuid({ version: 'uuidv4' }).required(),
	verification_url: Joi.string().uri(),
	first_name: Joi.string(),
	last_name: Joi.string(),
});

router.post(
	'/register',
	checkRateLimit,
	asyncHandler(async (req, _res, next) => {
		const { error, value } = registerSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const usersService = new UsersService({ accountability: null, schema: req.schema });
		await usersService.registerUser(value);

		return next();
	}),
	respond,
);

const verifyRegistrationSchema = Joi.string();

router.get(
	'/register/verify-email',
	asyncHandler(async (req, _res, next) => {
		const { error, value } = verifyRegistrationSchema.validate(req.query['token']);

		if (error) {
			logger.error(error, `Invalid token: ${value}`);
			throw new InvalidTokenError();
		}


		const service = new UsersService({ accountability: null, schema: req.schema });
		await service.verifyRegistration(value);

		return next();
	}),
	respond,
);

const resendInviteSchema = Joi.object({
	email: Joi.alternatives(Joi.string().email(), Joi.array().items(Joi.string().email())).required(),
	verification_url: Joi.string().uri(),
});
router.post(
	'/register/verify-email/resend',
	asyncHandler(async (req, _res, next) => {
		const { error } = resendInviteSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const service = new UsersService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.resendVerificationEmail(toLowerCase(req.body.email) as string, req.body.verification_url || null);

		return next();
	}),
	respond,
);

export default router;