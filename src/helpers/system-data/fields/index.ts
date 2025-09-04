import { loadYamlFile } from '../load-yaml.js';

const defaults = loadYamlFile('./fields/_defaults.yaml');
const activityFields = loadYamlFile('./fields/activity.yaml');
const fileFields = loadYamlFile('./fields/files.yaml');
const folderFields = loadYamlFile('./fields/folders.yaml');
const migrationFields = loadYamlFile('./fields/migrations.yaml');
const notificationFields = loadYamlFile('./fields/notifications.yaml');
const organizationFields = loadYamlFile('./fields/organizations.yaml');
const permissionFields = loadYamlFile('./fields/permissions.yaml');
const revisionFields = loadYamlFile('./fields/revisions.yaml');
const roleFields = loadYamlFile('./fields/roles.yaml');
const sessionFields = loadYamlFile('./fields/sessions.yaml');
const settingsFields = loadYamlFile('./fields/settings.yaml');
const translationFields = loadYamlFile('./fields/translations.yaml');
const userFields = loadYamlFile('./fields/users.yaml');

import { FieldMeta } from '../types.js';

export const systemFieldRows: FieldMeta[] = [];

processFields(activityFields);
processFields(fileFields);
processFields(folderFields);
processFields(migrationFields);
processFields(permissionFields);
processFields(revisionFields);
processFields(roleFields);
processFields(sessionFields);
processFields(userFields);
processFields(notificationFields);
processFields(translationFields);
processFields(organizationFields);
processFields(settingsFields);


function processFields(systemFields: Record<string, any>) {
	const { fields, table } = systemFields as { fields: FieldMeta[]; table: string };

	fields.forEach((field, index) => {
		systemFieldRows.push({
			system: true,
			...defaults,
			...field,
			collection: table,
			sort: index + 1,
		});
	});
}
