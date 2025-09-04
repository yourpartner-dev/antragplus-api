import type { Driver } from './storage-manager/index.js';

export const _aliasMap: Record<string, string> = {
	local: './storage-driver-local/index.js',
	s3: './storage-driver-s3/index.js',
	gcs: './storage-driver-gcs/index.js',
	azure: './storage-driver-azure/index.js',
};

export const getStorageDriver = async (driverName: string): Promise<typeof Driver> => {
	if (driverName in _aliasMap) {
		driverName = _aliasMap[driverName]!;
	} else {
		throw new Error(`Driver "${driverName}" doesn't exist.`);
	}

	return (await import(driverName)).default;
};
