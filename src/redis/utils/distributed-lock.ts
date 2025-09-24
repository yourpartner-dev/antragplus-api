import { useLogger } from '../../helpers/logger/index.js';
import { useRedis } from '../../redis/index.js';

const logger = useLogger();

export async function withLock<T>(
    lockKey: string,
    operation: () => Promise<T>,
    timeoutMs: number = 30000
): Promise<T | null> {
    const redis = useRedis();
    const lockValue = `${process.pid}:${Date.now()}`;
    const fullLockKey = `lock:measure:${lockKey}`;

    // Start time tracking
    const startTime = Date.now();

    // Set Redis lock TTL to 2x operation timeout to prevent premature expiry
    const lockTtlMs = Math.max(timeoutMs * 2, 60000); // Minimum 1 minute TTL
    const acquired = await redis.set(fullLockKey, lockValue, 'PX', lockTtlMs, 'NX');

    if (!acquired) {
        logger.debug(`Lock already held for ${lockKey}`);
        return null;
    }

    try {
        const result = await Promise.race([
            operation(),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Operation timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);

        const duration = Date.now() - startTime;
        if (duration > timeoutMs * 0.8) {
            logger.warn(`Operation took ${duration}ms (>80% of timeout) for ${lockKey}`);
        }

        return result as T;
    } catch (error: any) {
        const duration = Date.now() - startTime;
        if (error.message?.includes('timed out')) {
            logger.warn(`Operation timed out after ${duration}ms for ${lockKey}. Consider increasing timeout or optimizing operation.`);
        } else {
            logger.error(`Error in locked operation: ${error}`);
        }
        throw error;
    } finally {
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        try {
            await redis.eval(script, 1, fullLockKey, lockValue);
        } catch (error) {
            logger.error(`Error releasing lock: ${error}`);
        }
    }
}