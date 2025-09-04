import { createKv, type Kv } from '../../memory/index.js';
import { redisConfigAvailable, useRedis } from '../../../redis/index.js';

export const _cache: { lock: Kv | undefined } = {
	lock: undefined,
};

/**
 * Returns globally shared lock kv instance.
 */
export const useLock = () => {
	if (_cache.lock) {
		return _cache.lock;
	}

	if (redisConfigAvailable()) {
		_cache.lock = createKv({ type: 'redis', redis: useRedis(), namespace: 'yourpartner:lock' });
	} else {
		_cache.lock = createKv({ type: 'local' });
	}

	return _cache.lock;
};
