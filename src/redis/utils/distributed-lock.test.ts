import { useLogger } from '../../helpers/logger/index.js';
import { useRedis } from '../../redis/index.js';
import { withLock } from './distributed-lock.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../helpers/logger/index.js');
vi.mock('../../redis/index.js');

const mockRedis = {
    set: vi.fn(),
    eval: vi.fn(),
};

const mockLogger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

beforeEach(() => {
    vi.mocked(useRedis).mockReturnValue(mockRedis as any);
    vi.mocked(useLogger).mockReturnValue(mockLogger as any);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('withLock', () => {
    test('successfully acquires and releases lock', async () => {
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        
        const operation = vi.fn().mockResolvedValue('result');
        
        const result = await withLock('test-key', operation);
        
        expect(result).toBe('result');
        expect(mockRedis.set).toHaveBeenCalledWith(
            'lock:measure:test-key',
            expect.stringMatching(/^\d+:\d+$/),
            'PX',
            1000,
            'NX'
        );
        expect(operation).toHaveBeenCalledTimes(1);
        expect(mockRedis.eval).toHaveBeenCalled();
    });

    test('returns null when lock cannot be acquired', async () => {
        mockRedis.set.mockResolvedValue(null);
        
        const operation = vi.fn().mockResolvedValue('result');
        
        const result = await withLock('test-key', operation);
        
        expect(result).toBeNull();
        expect(operation).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith('Lock already held for test-key');
    });

    test('handles operation timeout', async () => {
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        
        const operation = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 2000)));
        
        await expect(withLock('test-key', operation, 100)).rejects.toThrow('Operation timed out after 100ms');
    });

    test('logs warning when operation takes >80% of timeout', async () => {
        mockRedis.set.mockResolvedValue('OK');
        mockRedis.eval.mockResolvedValue(1);
        
        const operation = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 850));
            return 'result';
        });
        
        const result = await withLock('test-key', operation, 1000);
        
        expect(result).toBe('result');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/Operation took \d+ms \(>80% of timeout\) for test-key/));
    });
}); 