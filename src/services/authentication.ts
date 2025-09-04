import { Action } from '../constants.js';
import { useEnv } from '../helpers/env/index.js';
import {
	InvalidCredentialsError,
	InvalidOtpError,
	ServiceUnavailableError,
	UserSuspendedError,
} from '../helpers/errors/index.js';
import type { Accountability, SchemaOverview } from '../types/index.js';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { clone, cloneDeep } from 'lodash-es';
import { performance } from 'perf_hooks';
import { getAuthProvider } from '../auth.js';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { RateLimiterRes, createRateLimiter } from '../rate-limiter.js';
import type { AbstractServiceOptions, YourPartnerTokenPayload, LoginResult, Session, User } from '../types/index.js';
import { getMilliseconds } from '../helpers/utils/get-milliseconds.js';
import { getSecret } from '../helpers/utils/get-secret.js';
import { stall } from '../helpers/utils/stall.js';
import { ActivityService } from './activity.js';
import { SettingsService } from './settings.js';
import { TFAService } from './tfa.js';

const env = useEnv();

const loginAttemptsLimiter = createRateLimiter('RATE_LIMITER', { duration: 0 });

export class AuthenticationService {
	knex: Knex;
	accountability: Accountability | null;
	activityService: ActivityService;
	schema: SchemaOverview;

	constructor(options: AbstractServiceOptions) {
		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.activityService = new ActivityService({ knex: this.knex, schema: options.schema });
		this.schema = options.schema;
	}

	/**
	 * Retrieve the tokens for a given user email.
	 *
	 * Password is optional to allow usage of this function within the SSO flow and extensions. Make sure
	 * to handle password existence checks elsewhere
	 */
	async login(
		providerName: string = DEFAULT_AUTH_PROVIDER,
		payload: Record<string, any>,
		options?: Partial<{
			otp: string;
			session: boolean;
		}>,
	): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');

		const STALL_TIME = env['LOGIN_STALL_TIME'] as number;
		const timeStart = performance.now();

		const provider = getAuthProvider(providerName);

		let userId;

		try {
			userId = await provider.getUserID(cloneDeep(payload));
		} catch (err) {
			await stall(STALL_TIME, timeStart);
			throw err;
		}

		const user = await this.knex
			.select<User & { tfa_secret: string | null }>(
				'u.id',
				'u.first_name',
				'u.last_name',
				'u.email',
				'u.password',
				'u.status',
				'u.role',
				'r.admin_access',
				'r.app_access',
				'u.tfa_secret',
				'u.provider',
				'u.external_identifier',
				'u.auth_data',
			)
			.from('yp_users as u')
			.leftJoin('yp_roles as r', 'u.role', 'r.id')
			.where('u.id', userId)
			.first();

		const updatedPayload = await emitter.emitFilter(
			'auth.login',
			payload,
			{
				status: 'pending',
				user: user?.id,
				provider: providerName,
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const emitStatus = (status: 'fail' | 'success') => {
			emitter.emitAction(
				'auth.login',
				{
					payload: updatedPayload,
					status,
					user: user?.id,
					provider: providerName,
				},
				{
					database: this.knex,
					schema: this.schema,
					accountability: this.accountability,
				},
			);
		};

		if (user?.status !== 'active' || user?.provider !== providerName) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw new InvalidCredentialsError();
		}

		const settingsService = new SettingsService({
			knex: this.knex,
			schema: this.schema,
		});

		const { auth_login_attempts: allowedAttempts } = await settingsService.readSingleton({
			fields: ['auth_login_attempts'],
		});

		if (allowedAttempts !== null) {
			loginAttemptsLimiter.points = allowedAttempts;

			try {
				await loginAttemptsLimiter.consume(user.id);
			} catch (error) {
				if (error instanceof RateLimiterRes && error.remainingPoints === 0) {
					await this.knex('yp_users').update({ status: 'suspended' }).where({ id: user.id });
					user.status = 'suspended';

					// This means that new attempts after the user has been re-activated will be accepted
					await loginAttemptsLimiter.set(user.id, 0, 0);
				} else {
					throw new ServiceUnavailableError({
						service: 'authentication',
						reason: 'Rate limiter unreachable',
					});
				}
			}
		}

		try {
			await provider.login(clone(user), cloneDeep(updatedPayload));
		} catch (e) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw e;
		}

		if (user.tfa_secret && !options?.otp) {
			emitStatus('fail');
			await stall(STALL_TIME, timeStart);
			throw new InvalidOtpError();
		}

		if (user.tfa_secret && options?.otp) {
			const tfaService = new TFAService({ knex: this.knex, schema: this.schema });
			const otpValid = await tfaService.verifyOTP(user.id, options?.otp);

			if (otpValid === false) {
				emitStatus('fail');
				await stall(STALL_TIME, timeStart);
				throw new InvalidOtpError();
			}
		}

		const tokenPayload: YourPartnerTokenPayload = {
			id: user.id,
			role: user.role,
			app_access: user.app_access,
			admin_access: user.admin_access,
		};

		const refreshToken = nanoid(64);
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(env['REFRESH_TOKEN_TTL'], 0));

		if (options?.session) {
			tokenPayload.session = refreshToken;
		}

		const customClaims = await emitter.emitFilter(
			'auth.jwt',
			tokenPayload,
			{
				status: 'pending',
				user: user?.id,
				provider: providerName,
				type: 'login',
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const TTL = env[options?.session ? 'SESSION_COOKIE_TTL' : 'ACCESS_TOKEN_TTL'] as string;

		const accessToken = jwt.sign(customClaims, getSecret(), {
			expiresIn: TTL,
			issuer: 'yourpartner',
		});

		await this.knex('yp_sessions').insert({
			token: refreshToken,
			user: user.id,
			expires: refreshTokenExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
		});

		await this.knex('yp_sessions').delete().where('expires', '<', new Date());

		if (this.accountability) {
			await this.activityService.createOne({
				action: Action.LOGIN,
				user: user.id,
				ip: this.accountability.ip,
				user_agent: this.accountability.userAgent,
				origin: this.accountability.origin,
				collection: 'yp_users',
				item: user.id,
			});
		}

		await this.knex('yp_users').update({ last_access: new Date() }).where({ id: user.id });

		emitStatus('success');

		if (allowedAttempts !== null) {
			await loginAttemptsLimiter.set(user.id, 0, 0);
		}

		await stall(STALL_TIME, timeStart);

		return {
			accessToken,
			refreshToken,
			expires: getMilliseconds(TTL),
			id: user.id,
		};
	}

	async refresh(refreshToken: string, options?: Partial<{ session: boolean }>): Promise<LoginResult> {
		const { nanoid } = await import('nanoid');
		const STALL_TIME = env['LOGIN_STALL_TIME'] as number;
		const timeStart = performance.now();

		if (!refreshToken) {
			throw new InvalidCredentialsError();
		}

		const record = await this.knex
			.select({
				session_expires: 's.expires',
				session_next_token: 's.next_token',
				user_id: 'u.id',
				user_first_name: 'u.first_name',
				user_last_name: 'u.last_name',
				user_email: 'u.email',
				user_password: 'u.password',
				user_status: 'u.status',
				user_provider: 'u.provider',
				user_external_identifier: 'u.external_identifier',
				user_auth_data: 'u.auth_data',
				role_id: 'r.id',
				role_admin_access: 'r.admin_access',
				role_app_access: 'r.app_access',
			})
			.from('yp_sessions AS s')
			.leftJoin('yp_users AS u', 's.user', 'u.id')
			.leftJoin('yp_roles AS r', 'u.role', 'r.id')
			.where('s.token', refreshToken)
			.andWhere('s.expires', '>=', new Date())
			.first();

		if (!record || (!record.user_id)) {
			throw new InvalidCredentialsError();
		}

		if (record.user_id && record.user_status !== 'active') {
			await this.knex('yp_sessions').where({ token: refreshToken }).del();

			if (record.user_status === 'suspended') {
				await stall(STALL_TIME, timeStart);
				throw new UserSuspendedError();
			} else {
				await stall(STALL_TIME, timeStart);
				throw new InvalidCredentialsError();
			}
		}

		if (record.user_id) {
			const provider:any = getAuthProvider(record.user_provider);

			await provider.refresh({
				id: record.user_id,
				first_name: record.user_first_name,
				last_name: record.user_last_name,
				email: record.user_email,
				password: record.user_password,
				status: record.user_status,
				provider: record.user_provider,
				external_identifier: record.user_external_identifier,
				auth_data: record.user_auth_data,
				role: record.role_id,
				app_access: record.role_app_access,
				admin_access: record.role_admin_access,
			});
		}

		let newRefreshToken = record.session_next_token ?? nanoid(64);
		const sessionDuration = env[options?.session ? 'SESSION_COOKIE_TTL' : 'REFRESH_TOKEN_TTL'];
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(sessionDuration, 0));

		const tokenPayload: YourPartnerTokenPayload = {
			id: record.user_id,
			role: record.role_id,
			app_access: record.role_app_access,
			admin_access: record.role_admin_access,
		};

		if (options?.session) {
			newRefreshToken = await this.updateStatefulSession(record, refreshToken, newRefreshToken, refreshTokenExpiration);
			tokenPayload.session = newRefreshToken;
		} else {
			// Original stateless token behavior
			await this.knex('yp_sessions')
				.update({
					token: newRefreshToken,
					expires: refreshTokenExpiration,
				})
				.where({ token: refreshToken });
		}

		const customClaims = await emitter.emitFilter(
			'auth.jwt',
			tokenPayload,
			{
				status: 'pending',
				user: record.user_id,
				provider: record.user_provider,
				type: 'refresh',
			},
			{
				database: this.knex,
				schema: this.schema,
				accountability: this.accountability,
			},
		);

		const TTL = env[options?.session ? 'SESSION_COOKIE_TTL' : 'ACCESS_TOKEN_TTL'] as string;

		const accessToken = jwt.sign(customClaims, getSecret(), {
			expiresIn: TTL,
			issuer: 'yourpartner',
		});

		if (record.user_id) {
			await this.knex('yp_users').update({ last_access: new Date() }).where({ id: record.user_id });
		}

		// Clear expired sessions for the current user
		await this.knex('yp_sessions')
			.delete()
			.where({
				user: record.user_id,
			})
			.andWhere('expires', '<', new Date());

		return {
			accessToken,
			refreshToken: newRefreshToken,
			expires: getMilliseconds(TTL),
			id: record.user_id,
		};
	}

	private async updateStatefulSession(
		sessionRecord: Record<string, any>,
		oldSessionToken: string,
		newSessionToken: string,
		sessionExpiration: Date,
	): Promise<string> {
		if (sessionRecord['session_next_token']) {
			// The current session token was already refreshed and has a reference
			// to the new session, update the new session timeout for the new refresh
			await this.knex('yp_sessions')
				.update({
					expires: sessionExpiration,
				})
				.where({ token: newSessionToken });

			return newSessionToken;
		}

		// Keep the old session active for a short period of time
		const GRACE_PERIOD = getMilliseconds(env['SESSION_REFRESH_GRACE_PERIOD'], 10_000);

		// Update the existing session record to have a short safety timeout
		// before expiring, and add the reference to the new session token
		const updatedSession = await this.knex('yp_sessions')
			.update(
				{
					next_token: newSessionToken,
					expires: new Date(Date.now() + GRACE_PERIOD),
				},
				['next_token'],
			)
			.where({ token: oldSessionToken, next_token: null });

		if (updatedSession.length === 0) {
			// Don't create a new session record, we already have a "next_token" reference
			const { next_token } = await this.knex('yp_sessions')
				.select('next_token')
				.where({ token: oldSessionToken })
				.first();

			return next_token;
		}

		// Instead of updating the current session record with a new token,
		// create a new copy with the new token
		await this.knex('yp_sessions').insert({
			token: newSessionToken,
			user: sessionRecord['user_id'],
			expires: sessionExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
		});

		return newSessionToken;
	}

	async logout(refreshToken: string): Promise<void> {
		const record = await this.knex
			.select<User & Session>(
				'u.id',
				'u.first_name',
				'u.last_name',
				'u.email',
				'u.password',
				'u.status',
				'u.role',
				'u.provider',
				'u.external_identifier',
				'u.auth_data',
			)
			.from('yp_sessions as s')
			.innerJoin('yp_users as u', 's.user', 'u.id')
			.where('s.token', refreshToken)
			.first();

		if (record) {
			const user = record;

			const provider = getAuthProvider(user.provider);
			await provider.logout(clone(user));

			await this.knex.delete().from('yp_sessions').where('token', refreshToken);
		}
	}

	async verifyPassword(userID: string, password: string): Promise<void> {
		const user = await this.knex
			.select<User>(
				'id',
				'first_name',
				'last_name',
				'email',
				'password',
				'status',
				'role',
				'provider',
				'external_identifier',
				'auth_data',
			)
			.from('yp_users')
			.where('id', userID)
			.first();

		if (!user) {
			throw new InvalidCredentialsError();
		}

		const provider = getAuthProvider(user.provider);
		await provider.verify(clone(user), password);
	}
}
