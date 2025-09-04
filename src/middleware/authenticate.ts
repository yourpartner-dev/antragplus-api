import type { Accountability } from '../types/accountability.js';
import type { NextFunction, Request, Response } from 'express';
import { isEqual } from 'lodash-es';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import asyncHandler from '../helpers/utils/async-handler.js';
import { getAccountabilityForToken } from '../helpers/utils/get-accountability-for-token.js';
import { getIPFromReq } from '../helpers/utils/get-ip-from-req.js';
import { ErrorCode, isYPError } from '../helpers/errors/index.js';
import { useEnv } from '../helpers/env/index.js';
import { SESSION_COOKIE_OPTIONS } from '../constants.js';

/**
 * Verify the passed JWT and assign the user ID and role to `req`
 */
export const handler = async (req: Request, res: Response, next: NextFunction) => {
	
	const env = useEnv();

	const defaultAccountability: Accountability = {
		user: null,
		role: null,
		admin: false,
		app: false,
		ip: getIPFromReq(req),
	};

	const userAgent = req.get('user-agent')?.substring(0, 1024);
	if (userAgent) defaultAccountability.userAgent = userAgent;

	const origin = req.get('origin');
	if (origin) defaultAccountability.origin = origin;

	const database = getDatabase();

	const customAccountability = await emitter.emitFilter(
		'authenticate',
		defaultAccountability,
		{
			req,
		},
		{
			database,
			schema: null,
			accountability: null,
		},
	);

	if (customAccountability && isEqual(customAccountability, defaultAccountability) === false) {
		req.accountability = customAccountability;
		return next();
	}

	try {
		req.accountability = await getAccountabilityForToken(req.token, defaultAccountability);
	} catch (err) {
		if (isYPError(err, ErrorCode.InvalidCredentials) || isYPError(err, ErrorCode.InvalidToken)) {
			if (req.cookies[env['SESSION_COOKIE_NAME'] as string] === req.token) {
				// clear the session token if ended up in an invalid state
				res.clearCookie(env['SESSION_COOKIE_NAME'] as string, SESSION_COOKIE_OPTIONS);
			}
		}

		throw err;
	}

	return next();
};

export default asyncHandler(handler);
