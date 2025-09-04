import { loadYamlFile } from '../load-yaml.js';

import { DataPermission, Permission } from '../types.js';

const schemaPermissionsRaw = loadYamlFile('./app-access-permissions/schema-access-permissions.yaml');
const permissions = loadYamlFile('./app-access-permissions/app-access-permissions.yaml');

const defaults: Partial<Permission> = {
	role: null,
	permissions: {},
	validation: null,
	presets: null,
	fields: ['*'],
	system: true,
};

export const schemaPermissions = (schemaPermissionsRaw as unknown as DataPermission[]).map(
	(row) => ({ ...defaults, ...row }) as Permission,
);

export const appAccessMinimalPermissions = [...schemaPermissions, ...(permissions as unknown as DataPermission[])].map(
	(row) => ({ ...defaults, ...row }) as Permission,
);
