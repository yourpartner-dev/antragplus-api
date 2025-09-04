import { useEnv } from '../helpers/env/index.js';
import { HitRateLimitError } from '../helpers/errors/index.js';
import type { RequestHandler } from 'express';
import type { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createRateLimiter } from '../rate-limiter.js';
import asyncHandler from '../helpers/utils/async-handler.js';
import { getIPFromReq } from '../helpers/utils/get-ip-from-req.js';
import { validateEnv } from '../helpers/utils/validate-env.js';

let checkRateLimit: RequestHandler = (_req, _res, next) => next();

export let rateLimiter: RateLimiterRedis | RateLimiterMemory;

const env = useEnv();

if (env['RATE_LIMITER_ENABLED'] === true) {
	validateEnv(['RATE_LIMITER_STORE', 'RATE_LIMITER_DURATION', 'RATE_LIMITER_POINTS']);

	rateLimiter = createRateLimiter('RATE_LIMITER');

	checkRateLimit = asyncHandler(async (req, res, next) => {
		const ip = getIPFromReq(req);

		if (ip) {
			try {
				await rateLimiter.consume(ip, 1);
			} catch (rateLimiterRes: any) {
				if (rateLimiterRes instanceof Error) throw rateLimiterRes;

				res.set('Retry-After', String(Math.round(rateLimiterRes.msBeforeNext / 1000)));
				throw new HitRateLimitError({
					limit: +(env['RATE_LIMITER_POINTS'] as string),
					reset: new Date(Date.now() + rateLimiterRes.msBeforeNext),
				});
			}
		}

		next();
	});
}

export default checkRateLimit;
