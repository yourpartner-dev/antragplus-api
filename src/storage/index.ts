import { validateEnv } from '../helpers/utils/validate-env.js';
import { registerDrivers } from './register-drivers.js';
import { registerLocations } from './register-locations.js';
import type { StorageManager } from './storage-manager/index.js';

export const _cache: { storage: any | null } = {
	storage: null,
};

export const getStorage = async (): Promise<StorageManager> => {
	if (_cache.storage) return _cache.storage;

	const { StorageManager } = await import('./storage-manager/index.js');

	validateEnv(['STORAGE_LOCATIONS']);

	const storage = new StorageManager();

	await registerDrivers(storage);
	await registerLocations(storage);

	_cache.storage = storage;

	return storage;
};
