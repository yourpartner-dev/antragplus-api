import { InvalidCredentialsError } from '../../helpers/errors/index.js';
import type { Accountability } from '../../types/index.js';
import getDatabase from '../../database/index.js';
import { getSecret } from './get-secret.js';
import isYourPartnerJWT from './is-yourpartner-jwt.js';
import { verifySessionJWT } from './verify-session-jwt.js';
import { verifyAccessJWT } from './jwt.js';

export async function getAccountabilityForToken(
	token?: string | null,
	accountability?: Accountability,
): Promise<Accountability> {
	if (!accountability) {
		accountability = {
			user: null,
			role: null,
			admin: false,
			app: false,
		};
	}

	if (token) {
		if (isYourPartnerJWT(token)) {
			const payload = verifyAccessJWT(token, getSecret());

			if ('session' in payload) {
				await verifySessionJWT(payload);
			}

			accountability.role = payload.role;
			accountability.admin = payload.admin_access === true || payload.admin_access == 1;
			accountability.app = payload.app_access === true || payload.app_access == 1;

			if (payload.share) accountability.share = payload.share;
			if (payload.share_scope) accountability.share_scope = payload.share_scope;
			if (payload.id) accountability.user = payload.id;
		} else {
			// Try finding the user with the provided token
			const database = getDatabase();

			const user = await database
				.select('yp_users.id', 'yp_users.role', 'yp_roles.admin_access', 'yp_roles.app_access')
				.from('yp_users')
				.leftJoin('yp_roles', 'yp_users.role', 'yp_roles.id')
				.where({
					'yp_users.token': token,
					status: 'active',
				})
				.first();

			if (!user) {
				throw new InvalidCredentialsError();
			}

			accountability.user = user.id;
			accountability.role = user.role;
			accountability.admin = user.admin_access === true || user.admin_access == 1;
			accountability.app = user.app_access === true || user.app_access == 1;
		}
	}

	return accountability;
}
