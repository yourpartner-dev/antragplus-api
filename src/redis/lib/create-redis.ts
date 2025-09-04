import { useEnv } from '../../helpers/env/index.js';
import { Redis } from 'ioredis';
import { getConfigFromEnv } from '../../helpers/utils/get-config-from-env.js';

/**
 * Create a new Redis instance based on the global env configuration
 *
 * @returns New Redis instance based on global configuration
 */
export const createRedis = () => {
	const env = useEnv();
	return new Redis(env['REDIS'] ?? getConfigFromEnv('REDIS'));
};
