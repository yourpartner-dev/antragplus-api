import { InvalidPayloadError, UnprocessableContentError } from '../helpers/errors/index.js';
import type { Alterations, Item, PrimaryKey, Query, User } from '../types/index.js';
import { getMatch } from 'ip-matching';
import { omit } from 'lodash-es';
import type { AbstractServiceOptions, MutationOptions } from '../types/index.js';
import { shouldClearCache } from '../helpers/utils/should-clear-cache.js';
import { transaction } from '../helpers/utils/transaction.js';
import { ItemsService } from './items.js';
import { PermissionsService } from './permissions/index.js';
import { UsersService } from './users.js';

// type RoleCount = {
// 	count: number | string;
// 	admin_access: number | boolean | null;
// 	app_access: number | boolean | null;
// };

export class RolesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('yp_roles', options);
	}

	private async checkForOtherAdminRoles(excludeKeys: PrimaryKey[]): Promise<void> {
		// Make sure there's at least one admin role left after this deletion is done
		const otherAdminRoles = await this.knex
			.count('*', { as: 'count' })
			.from('yp_roles')
			.whereNotIn('id', excludeKeys)
			.andWhere({ admin_access: true })
			.first();

		const otherAdminRolesCount = Number(otherAdminRoles?.count ?? 0);

		if (otherAdminRolesCount === 0) {
			throw new UnprocessableContentError({ reason: `You can't delete the last admin role` });
		}
	}

	private async checkForOtherAdminUsers(
		key: PrimaryKey,
		users: Alterations<User, 'id'> | (string | Partial<User>)[],
	): Promise<void> {
		const role = await this.knex.select('admin_access').from('yp_roles').where('id', '=', key).first();

		// No-op if role doesn't exist
		if (!role) return;

		const usersBefore = (await this.knex.select('id').from('yp_users').where('role', '=', key)).map(
			(user) => user.id,
		);

		const usersAdded: (Partial<User> & Pick<User, 'id'>)[] = [];
		const usersUpdated: (Partial<User> & Pick<User, 'id'>)[] = [];
		const usersCreated: Partial<User>[] = [];
		const usersRemoved: string[] = [];

		if (Array.isArray(users)) {
			const usersKept: string[] = [];

			for (const user of users) {
				if (typeof user === 'string') {
					if (usersBefore.includes(user)) {
						usersKept.push(user);
					} else {
						usersAdded.push({ id: user });
					}
				} else if (user.id) {
					if (usersBefore.includes(user.id)) {
						usersKept.push(user.id);
						usersUpdated.push(user as Partial<User> & Pick<User, 'id'>);
					} else {
						usersAdded.push(user as Partial<User> & Pick<User, 'id'>);
					}
				} else {
					usersCreated.push(user);
				}
			}

			usersRemoved.push(...usersBefore.filter((user) => !usersKept.includes(user)));
		} else {
			for (const user of users.update) {
				if (usersBefore.includes(user['id'])) {
					usersUpdated.push(user);
				} else {
					usersAdded.push(user);
				}
			}

			usersCreated.push(...users.create);
			usersRemoved.push(...users.delete);
		}

		if (role.admin_access === false || role.admin_access === 0) {
			// Admin users might have moved in from other role, thus becoming non-admin
			if (usersAdded.length > 0) {
				const otherAdminUsers = await this.knex
					.count('*', { as: 'count' })
					.from('yp_users')
					.leftJoin('yp_roles', 'yp_users.role', 'yp_roles.id')
					.whereNotIn(
						'yp_users.id',
						usersAdded.map((user) => user.id),
					)
					.andWhere({ 'yp_roles.admin_access': true, status: 'active' })
					.first();

				const otherAdminUsersCount = Number(otherAdminUsers?.count ?? 0);

				if (otherAdminUsersCount === 0) {
					throw new UnprocessableContentError({ reason: `You can't remove the last admin user from the admin role` });
				}
			}

			return;
		}

		// Only added or created new users
		if (usersUpdated.length === 0 && usersRemoved.length === 0) return;

		// Active admin user(s) about to be created
		if (usersCreated.some((user) => !('status' in user) || user.status === 'active')) return;

		const usersDeactivated = [...usersAdded, ...usersUpdated]
			.filter((user) => 'status' in user && user.status !== 'active')
			.map((user) => user.id);

		const usersAddedNonDeactivated = usersAdded
			.filter((user) => !usersDeactivated.includes(user.id))
			.map((user) => user.id);

		// Active user(s) about to become admin
		if (usersAddedNonDeactivated.length > 0) {
			const userCount = await this.knex
				.count('*', { as: 'count' })
				.from('yp_users')
				.whereIn('id', usersAddedNonDeactivated)
				.andWhere({ status: 'active' })
				.first();

			if (Number(userCount?.count ?? 0) > 0) {
				return;
			}
		}

		const otherAdminUsers = await this.knex
			.count('*', { as: 'count' })
			.from('yp_users')
			.leftJoin('yp_roles', 'yp_users.role', 'yp_roles.id')
			.whereNotIn('yp_users.id', [...usersDeactivated, ...usersRemoved])
			.andWhere({ 'yp_roles.admin_access': true, status: 'active' })
			.first();

		const otherAdminUsersCount = Number(otherAdminUsers?.count ?? 0);

		if (otherAdminUsersCount === 0) {
			throw new UnprocessableContentError({ reason: `You can't remove the last admin user from the admin role` });
		}

		return;
	}

	private isIpAccessValid(value?: any[] | null): boolean {
		if (value === undefined) return false;
		if (value === null) return true;
		if (Array.isArray(value) && value.length === 0) return true;

		for (const ip of value) {
			if (typeof ip !== 'string' || ip.includes('*')) return false;

			try {
				const match = getMatch(ip);
				if (match.type == 'IPMask') return false;
			} catch {
				return false;
			}
		}

		return true;
	}

	private assertValidIpAccess(partialItem: Partial<Item>): void {
		if ('ip_access' in partialItem && !this.isIpAccessValid(partialItem['ip_access'])) {
			throw new InvalidPayloadError({
				reason: 'IP Access contains an incorrect value. Valid values are: IP addresses, IP ranges and CIDR blocks',
			});
		}
	}

	// private getRoleAccessType(data: Partial<Item>) {
	// 	if ('admin_access' in data && data['admin_access'] === true) {
	// 		return 'admin';
	// 	} else if (('app_access' in data && data['app_access'] === true) || 'app_access' in data === false) {
	// 		return 'app';
	// 	} else {
	// 		return 'api';
	// 	}
	// }

	override async createOne(data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		this.assertValidIpAccess(data);

		return super.createOne(data, opts);
	}

	override async createMany(data: Partial<Item>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		
		for (const partialItem of data) {
			this.assertValidIpAccess(partialItem);
		}

		return super.createMany(data, opts);
	}

	override async updateOne(key: PrimaryKey, data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey> {
		this.assertValidIpAccess(data);

		try {
			if ('users' in data) {
				await this.checkForOtherAdminUsers(key, data['users']);
			}

		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		return super.updateOne(key, data, opts);
	}

	override async updateBatch(data: Partial<Item>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		for (const partialItem of data) {
			this.assertValidIpAccess(partialItem);
		}

		const primaryKeyField = this.schema.collections[this.collection]!.primary;

		if (!opts.mutationTracker) {
			opts.mutationTracker = this.createMutationTracker();
		}

		const keys: PrimaryKey[] = [];

		try {
			await transaction(this.knex, async (trx) => {
				const service = new RolesService({
					accountability: this.accountability,
					knex: trx,
					schema: this.schema,
				});

				for (const item of data) {
					const combinedOpts = Object.assign({ autoPurgeCache: false }, opts);
					keys.push(await service.updateOne(item[primaryKeyField]!, omit(item, primaryKeyField), combinedOpts));
				}
			});
		} finally {
			if (shouldClearCache(this.cache, opts, this.collection)) {
				await this.cache.clear();
			}
		}

		return keys;
	}

	override async updateMany(keys: PrimaryKey[], data: Partial<Item>, opts?: MutationOptions): Promise<PrimaryKey[]> {
		this.assertValidIpAccess(data);

		try {
			if ('admin_access' in data && data['admin_access'] === false) {
				await this.checkForOtherAdminRoles(keys);
			}

		} catch (err: any) {
			(opts || (opts = {})).preMutationError = err;
		}

		return super.updateMany(keys, data, opts);
	}

	override async updateByQuery(
		query: Query,
		data: Partial<Item>,
		opts?: MutationOptions | undefined,
	): Promise<PrimaryKey[]> {
		this.assertValidIpAccess(data);

		return super.updateByQuery(query, data, opts);
	}

	override async deleteMany(keys: PrimaryKey[]): Promise<PrimaryKey[]> {
		const opts: MutationOptions = {};

		try {
			await this.checkForOtherAdminRoles(keys);
		} catch (err: any) {
			opts.preMutationError = err;
		}

		await transaction(this.knex, async (trx) => {
			const itemsService = new ItemsService('yp_roles', {
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			const permissionsService = new PermissionsService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			const usersService = new UsersService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			await permissionsService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...opts, bypassLimits: true },
			);
			await usersService.updateByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{
					status: 'suspended',
					role: null,
				},
				{ ...opts, bypassLimits: true },
			);

			await itemsService.deleteMany(keys, opts);
		});

		return keys;
	}
}
