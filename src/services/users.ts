import { useEnv } from '../helpers/env/index.js';
import { ForbiddenError, InvalidPayloadError, RecordNotUniqueError, UnprocessableContentError } from '../helpers/errors/index.js';
import type { Item, PrimaryKey, RegisterUserInput, User } from '../types/index.js';
import { getSimpleHash, toArray, validatePayload } from '../helpers/utils/index.js';
import { FailedValidationError, joiValidationErrorItemToErrorExtensions } from '../helpers/validation/index.js';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { isEmpty } from 'lodash-es';
import { performance } from 'perf_hooks';
import getDatabase from '../database/index.js';
import { useLogger } from '../helpers/logger/index.js';
import type { AbstractServiceOptions, MutationOptions } from '../types/index.js';
import { getSecret } from '../helpers/utils/get-secret.js';
import isUrlAllowed from '../helpers/utils/is-url-allowed.js';
import { verifyJWT } from '../helpers/utils/jwt.js';
import { stall } from '../helpers/utils/stall.js';
import { Url } from '../helpers/utils/url.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { SettingsService } from './settings.js';
import { toLowerCase } from '../helpers/utils/to-lower-case.js';

const env = useEnv();
const logger = useLogger();

export class UsersService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('yp_users', options);

		this.knex = options.knex || getDatabase();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}

	/**
	 * User email has to be unique case-insensitive. This is an additional check to make sure that
	 * the email is unique regardless of casing
	 */
	private async checkUniqueEmails(emails: string[], excludeKey?: PrimaryKey): Promise<void> {
		emails = emails.map((email) => email.toLowerCase());

		const duplicates = emails.filter((value, index, array) => array.indexOf(value) !== index);

		if (duplicates.length) {
			throw new RecordNotUniqueError({
				collection: 'yp_users',
				field: 'email',
			});
		}

		const query = this.knex
			.select('email')
			.from('yp_users')
			.whereRaw(`LOWER(??) IN (${emails.map(() => '?')})`, ['email', ...emails]);

		if (excludeKey) {
			query.whereNot('id', excludeKey);
		}

		const results = await query;

		if (results.length) {
			throw new RecordNotUniqueError({
				collection: 'yp_users',
				field: 'email',
			});
		}
	}

	/**
	 * Check if the provided password matches the strictness as configured in
	 * yp_settings.auth_password_policy
	 */
	private async checkPasswordPolicy(passwords: string[]): Promise<void> {
		const settingsService = new SettingsService({
			schema: this.schema,
			knex: this.knex,
		});

		const { auth_password_policy: policyRegExString } = await settingsService.readSingleton({
			fields: ['auth_password_policy'],
		});

		if (!policyRegExString) {
			return;
		}

		const wrapped = policyRegExString.startsWith('/') && policyRegExString.endsWith('/');
		const regex = new RegExp(wrapped ? policyRegExString.slice(1, -1) : policyRegExString);

		for (const password of passwords) {
			if (!regex.test(password)) {
				throw new FailedValidationError(
					joiValidationErrorItemToErrorExtensions({
						message: `Provided password doesn't match password policy`,
						path: ['password'],
						type: 'custom.pattern.base',
						context: {
							value: password,
						},
					}),
				);
			}
		}
	}

	private async checkRemainingAdminExistence(excludeKeys: PrimaryKey[]) {
		// Make sure there's at least one admin user left after this deletion is done
		const otherAdminUsers = await this.knex
			.count('*', { as: 'count' })
			.from('yp_users')
			.whereNotIn('yp_users.id', excludeKeys)
			.andWhere({ 'yp_roles.admin_access': true })
			.leftJoin('yp_roles', 'yp_users.role', 'yp_roles.id')
			.first();

		const otherAdminUsersCount = +(otherAdminUsers?.count || 0);

		if (otherAdminUsersCount === 0) {
			throw new UnprocessableContentError({ reason: `You can't remove the last admin user from the role` });
		}
	}

	/**
	 * Make sure there's at least one active admin user when updating user status
	 */
	private async checkRemainingActiveAdmin(excludeKeys: PrimaryKey[]): Promise<void> {
		const otherAdminUsers = await this.knex
			.count('*', { as: 'count' })
			.from('yp_users')
			.whereNotIn('yp_users.id', excludeKeys)
			.andWhere({ 'yp_roles.admin_access': true })
			.andWhere({ 'yp_users.status': 'active' })
			.leftJoin('yp_roles', 'yp_users.role', 'yp_roles.id')
			.first();

		const otherAdminUsersCount = +(otherAdminUsers?.count || 0);

		if (otherAdminUsersCount === 0) {
			throw new UnprocessableContentError({ reason: `You can't change the active status of the last admin user` });
		}
	}

	/**
	 * Get basic information of user identified by email
	 */
	private async getUserByEmail(
		email: string,
	): Promise<{ id: string; role: string; status: string; password: string; email: string; first_name: string; last_name: string, language: string, organization_id: string } | undefined> {
		return await this.knex
			.select('id', 'role', 'status', 'password', 'email', 'first_name', 'last_name', 'language', 'organization_id')
			.from('yp_users')
			.whereRaw(`LOWER(??) = ?`, ['email', email.toLowerCase()])
			.first();
	}

	/**
	 * Create URL for inviting users
	 */
	private inviteUrl(email: string, url: string | null): string {
		const payload = { email, scope: 'invite' };

		const token = jwt.sign(payload, getSecret(), { expiresIn: '7d', issuer: 'yourpartner' });

		return (url ? new Url(url) : new Url(env['PUBLIC_URL'] as string).addPath('admin', 'accept-invite'))
			.setQuery('token', token)
			.toString();
	}

	/**
	 * Validate array of emails. Intended to be used with create/update users
	 */
	private validateEmail(input: string | string[]) {

		const lcInput = toLowerCase(input);
		
		const emails = Array.isArray(lcInput) ? lcInput : [lcInput];

		const schema = Joi.string().email().required();

		for (const email of emails) {
			const { error } = schema.validate(email);

			if (error) {
				throw new FailedValidationError({
					field: 'email',
					type: 'email',
				});
			}
		}
	}

	/**
	 * Create a new user
	 */
	override async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		try {
			if (data['email']) {
				this.validateEmail(data['email']);
				await this.checkUniqueEmails([data['email']]);
			}

			if (data['password']) {
				await this.checkPasswordPolicy([data['password']]);
			}

		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		return await super.createOne(data, opts);
	}

	/**
	 * Create multiple new users
	 */
	override async createMany(data: Partial<Item>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		const emails = data['map']((payload) => payload['email']).filter((email) => email);
		const passwords = data['map']((payload) => payload['password']).filter((password) => password);
		//const roles = data['map']((payload) => payload['role']).filter((role) => role);

		try {
			if (emails.length) {
				this.validateEmail(emails);
				await this.checkUniqueEmails(emails);
			}

			if (passwords.length) {
				await this.checkPasswordPolicy(passwords);
			}

		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		return await super.createMany(data, opts);
	}

	/**
	 * Update many users by primary key
	 */
	override async updateMany(keys: PrimaryKey[], data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]> {
		try {

			if (data['role']) {
				/*
				 * data['role'] has the following cases:
				 * - a string with existing role id
				 * - an object with existing role id for GraphQL mutations
				 * - an object with data for new role
				 */
				const role = data['role']?.id ?? data['role'];

				let newRole;

				if (typeof role === 'string') {
					newRole = await this.knex
						.select('admin_access', 'app_access')
						.from('yp_roles')
						.where('id', role)
						.first();
				} else {
					newRole = role;
				}

				if (!newRole?.admin_access) {
					await this.checkRemainingAdminExistence(keys);
				}
			}

			if (data['status'] !== undefined && data['status'] !== 'active') {
				await this.checkRemainingActiveAdmin(keys);
			}

			if (data['email']) {
				if (keys.length > 1) {
					throw new RecordNotUniqueError({
						collection: 'yp_users',
						field: 'email',
					});
				}

				this.validateEmail(data['email']);
				await this.checkUniqueEmails([data['email']], keys[0]);
			}

			if (data['password']) {
				await this.checkPasswordPolicy([data['password']]);
			}

			if (data['tfa_secret'] !== undefined) {
				throw new InvalidPayloadError({ reason: `You can't change the "tfa_secret" value manually` });
			}

			if (data['provider'] !== undefined) {
				if (this.accountability && this.accountability.admin !== true) {
					throw new InvalidPayloadError({ reason: `You can't change the "provider" value manually` });
				}

				data['auth_data'] = null;
			}

			if (data['external_identifier'] !== undefined) {
				if (this.accountability && this.accountability.admin !== true) {
					throw new InvalidPayloadError({ reason: `You can't change the "external_identifier" value manually` });
				}

				data['auth_data'] = null;
			}
		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		return await super.updateMany(keys, data, opts);
	}

	/**
	 * Delete multiple users by primary key
	 */
	override async deleteMany(keys: PrimaryKey[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		try {
			await this.checkRemainingAdminExistence(keys);
		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		// Manual constraints
		await this.knex('yp_notifications').update({ sender: null }).whereIn('sender', keys);

		await super.deleteMany(keys, opts);
		return keys;
	}

	async inviteUser(email: string | string[], role: string, url: string | null, subject?: string | null, params?: any | null): Promise<PrimaryKey[]> {
		const opts: MutationOptions = {};

		try {
			if (url && isUrlAllowed(url, env['USER_INVITE_URL_ALLOW_LIST'] as string) === false) {
				throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to invite users` });
			}
		} catch (err: any) {
			opts.preMutationError = err;
		}

		const emails = toArray(email);

		const mailService = new MailService({
			schema: this.schema,
			accountability: this.accountability,
		});

		const users: PrimaryKey[] = [];
		for (const email of emails) {
			// Check if user is known
			const user:any = await this.getUserByEmail(email);

			// Create user first to verify uniqueness if unknown
			// If params are provided, add them to the user object if they key exists
			const userData: any = { email, role, status: 'invited' };
			if (isEmpty(user)) {
				if (params) {
					Object.keys(params).forEach(key => {
						userData[key] = params[key];
					});
				}
				if(!userData['language']) {
				
					const settings = await this.knex
						.select('language')
						.from('yp_settings')
						.where('organization_id', userData['organization_id'] ?? null)
						.first();
	
					if (settings?.language) {
						userData['language'] = settings.language;
					} else {
						userData['language'] = 'en-US';
					}
				}

				//TODO: review if this is the best way to do this
				users.push(await this.createOne(userData, opts));
				
				// For known users update role if changed
			} else if (user?.status === 'invited' && user?.role !== role) {
				users.push(await this.updateOne(user.id, { role }, opts));
			}

			// Send invite for new and already invited users
			if (isEmpty(user) || user?.status === 'invited') {
				const firstName = user?.first_name || userData['first_name'] || '';
				const lastName = user?.last_name || userData['last_name'] || '';
				const language = user?.language || userData['language'] || 'de-DE';
				const organization_id = user?.organization_id || userData['organization_id'] || null;
				const subjectLine = subject ?? `${language === 'en-US' ? 'Welcome' : 'Herzlich Willkommen'} ${firstName} ${lastName}!`;

				mailService
					.send({
						to: user?.email ?? email,
						subject: subjectLine,
						template: {
							name: 'user-invitation',
							data: {
								url: this.inviteUrl(user?.email ?? email, url),
								email: user?.email ?? email,
								first_name: user?.first_name ?? firstName,
								last_name: user?.last_name ?? lastName
							},
						},
						organization_id: organization_id,
						language: language,
					})
					.catch((error) => {
						logger.error(error, `Could not send user invitation mail`);
					});
			}
		}
		return users;
	}

	async acceptInvite(token: string, password: string, emailProvided: string): Promise<void> {
		const { email, scope } = verifyJWT(token, getSecret()) as {
			email: string;
			scope: string;
		};

		if (scope !== 'invite') throw new ForbiddenError();

		if (email !== emailProvided) throw new ForbiddenError();

		const user = await this.getUserByEmail(email);

		if (user?.status !== 'invited') {
			throw new InvalidPayloadError({ reason: `Email address ${email} hasn't been invited` });
		}

		// Allow unauthenticated update
		const service = new UsersService({
			knex: this.knex,
			schema: this.schema,
		});

		await service.updateOne(user.id, { password, status: 'active' });
	}

	async registerUser(input: RegisterUserInput) {
		if (
			input.verification_url &&
			isUrlAllowed(input.verification_url, env['USER_REGISTER_URL_ALLOW_LIST'] as string) === false
		) {
			throw new InvalidPayloadError({
				reason: `URL "${input.verification_url}" can't be used to verify registered users`,
			});
		}

		const STALL_TIME = env['REGISTER_STALL_TIME'] as number;
		const timeStart = performance.now();
		const serviceOptions: AbstractServiceOptions = { accountability: this.accountability, schema: this.schema };
		const settingsService = new SettingsService(serviceOptions);

		//The default settings is used to retrieve the public registration settings, organization_id is null
		//Later we should always use organization_id and retrieve the settings for the specific organization, instead of having one generic default
		const settings = await settingsService.readSingleton({
			filter: {
				organization_id: { _eq: input?.organization_id ?? null },
			},
			fields: [
				'public_registration',
				'public_registration_verify_email',
				'public_registration_role',
				'public_registration_email_filter'
			],
		});

		if (settings?.['public_registration'] == false) {
			throw new ForbiddenError();
		}

		const publicRegistrationRole = settings?.['public_registration_role'] ?? null;
		const hasEmailVerification = settings?.['public_registration_verify_email'];
		const emailFilter = settings?.['public_registration_email_filter'];
		const first_name = input.first_name ?? null;
		const last_name = input.last_name ?? null;

		const partialUser: Partial<User> = {
			// Required fields
			email: input.email,
			password: input.password,
			role: publicRegistrationRole,
			status: hasEmailVerification ? 'unverified' : 'active',
			// Optional fields
			first_name,
			last_name,
		};


		if (emailFilter && validatePayload(emailFilter, { email: input.email }).length !== 0) {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError();
		}

		const user = await this.getUserByEmail(input.email);

		//User can not be empty, as they're always created through HRIS integration or CSV upload. However email field must be overwritten
		if (isEmpty(user)) {
			await this.createOne(partialUser);
		} // We want to be able to re-send the verification email
		else if (user?.status !== ('unverified' satisfies User['status'])) {
			// To avoid giving attackers infos about registered emails we dont fail for violated unique constraints
			await stall(STALL_TIME, timeStart);
			return;
		}

		//If email verification is enabled, send a verification email
		if (hasEmailVerification) {
			const mailService = new MailService(serviceOptions);
			const payload = { email: input.email, scope: 'pending-registration' };

			const token = jwt.sign(payload, env['SECRET'] as string, {
				expiresIn: env['EMAIL_VERIFICATION_TOKEN_TTL'] as string,
				issuer: 'yourpartner',
			});

			const verificationUrl = (
				input.verification_url
					? new Url(input.verification_url)
					: new Url(env['PUBLIC_URL'] as string).addPath('users', 'register', 'verify-email')
			)
				.setQuery('token', token)
				.toString();

			mailService
				.send({
					to: input.email,
					subject: 'Verify your email address', // TODO: translate after theres support for internationalized emails
					template: {
						name: 'user-registration',
						data: {
							url: verificationUrl,
							email: input.email,
							first_name,
							last_name
						},
					},
					organization_id: user?.organization_id || null,
					language: user?.language|| 'en-US',
				})
				.catch((error) => {
					logger.error(error, 'Could not send email verification mail');
				});
		}

		await stall(STALL_TIME, timeStart);
	}

	async resendVerificationEmail(email: string, url: string | null): Promise<void> {
		const user: any = await this.getUserByEmail(email);

		if (isEmpty(user)) {
			// To avoid giving attackers infos about registered emails we just throw a forbidden error
			throw new ForbiddenError();
		}

		if (user?.status !== 'unverified') {
			// To avoid giving attackers infos about registered emails we just throw a forbidden error
			throw new ForbiddenError();
		}

		const mailService = new MailService({
			schema: this.schema,
			accountability: this.accountability,
		});

		const payload = { email: email, scope: 'pending-registration' };

		const token = jwt.sign(payload, env['SECRET'] as string, {
			expiresIn: env['EMAIL_VERIFICATION_TOKEN_TTL'] as string,
			issuer: 'yourpartner',
		});

		const verificationUrl = (
			url
				? new Url(url)
				: new Url(env['PUBLIC_URL'] as string).addPath('users', 'register', 'verify-email')
		)
			.setQuery('token', token)
			.toString();

		mailService
			.send({
				to: email,
				subject: 'Verify your email address', // TODO: translate after theres support for internationalized emails
				template: {
					name: 'user-registration',
					data: {
						url: verificationUrl,
						email: email,
						first_name: user?.first_name,
						last_name: user?.last_name,
					},
				},
				organization_id: user['organization_id'] || null,
				language: user['language'] || 'de-DE',
			})
			.catch((error) => {
				logger.error(error, 'Could not send email verification mail');
			});

	}

	async verifyRegistration(token: string): Promise<string> {
		const { email, scope } = verifyJWT(token, env['SECRET'] as string) as {
			email: string;
			scope: string;
		};

		if (scope !== 'pending-registration') throw new ForbiddenError();

		const user = await this.getUserByEmail(email);

		if (user?.status !== ('unverified' satisfies User['status'])) {
			throw new InvalidPayloadError({ reason: 'Invalid verification code' });
		}

		await this.updateOne(user.id, { status: 'active' });

		return user.id;
	}

	async requestPasswordReset(email: string, url: string | null, subject?: string | null): Promise<void> {
		const STALL_TIME = 500;
		const timeStart = performance.now();

		const user:any = await this.getUserByEmail(email);

		if (user?.status !== 'active') {
			await stall(STALL_TIME, timeStart);
			throw new ForbiddenError();
		}

		if (url && isUrlAllowed(url, env['PASSWORD_RESET_URL_ALLOW_LIST'] as string) === false) {
			throw new InvalidPayloadError({ reason: `URL "${url}" can't be used to reset passwords` });
		}

		const mailService = new MailService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		const payload = { email: user.email, scope: 'password-reset', hash: getSimpleHash('' + user.password) };
		const token = jwt.sign(payload, getSecret(), { expiresIn: '1d', issuer: 'yourpartner' });

		const acceptUrl = (url ? new Url(url) : new Url(env['PUBLIC_URL'] as string).addPath('admin', 'reset-password'))
			.setQuery('token', token)
			.toString();

		const subjectLine = subject ? subject : 'Password Reset Request';

		mailService
			.send({
				to: user.email,
				subject: subjectLine,
				template: {
					name: 'password-reset',
					data: {
						url: acceptUrl,
						email: user.email,
					},
				},
				organization_id: user['organization_id'] || null,
				language: user['language'] || 'de-DE',
			})
			.catch((error) => {
				logger.error(error, `Could not send password reset mail`);
			});

		await stall(STALL_TIME, timeStart);
	}

	async resetPassword(token: string, password: string): Promise<void> {
		const { email, scope, hash } = jwt.verify(token, getSecret(), { issuer: 'yourpartner' }) as {
			email: string;
			scope: string;
			hash: string;
		};

		if (scope !== 'password-reset' || !hash) throw new ForbiddenError();

		const opts: MutationOptions = {};

		try {
			await this.checkPasswordPolicy([password]);
		} catch (err: any) {
			opts.preMutationError = err;
		}

		const user = await this.getUserByEmail(email);

		if (user?.status !== 'active' || hash !== getSimpleHash('' + user.password)) {
			throw new ForbiddenError();
		}

		// Allow unauthenticated update
		const service = new UsersService({
			knex: this.knex,
			schema: this.schema,
			accountability: {
				...(this.accountability ?? { role: null }),
				admin: true, // We need to skip permissions checks for the update call below
			},
		});

		await service.updateOne(user.id, { password, status: 'active' }, opts);
	}
}
