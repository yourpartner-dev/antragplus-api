import { appAccessMinimalPermissions } from '../../../helpers/system-data/index.js';
import type { Accountability, Permission, Query } from '../../../types/index.js';
import { filterItems } from '../../../helpers/utils/filter-items.js';
import { mergePermissions } from '../../../helpers/utils/merge-permissions.js';

export function withAppMinimalPermissions(
	accountability: Accountability | null,
	permissions: Permission[],
	filter: Query['filter'],
): Permission[] {
	if (accountability?.app === true) {
		const filteredAppMinimalPermissions = filterItems(
			appAccessMinimalPermissions.map((permission) => ({
				...permission,
				role: accountability.role,
			})),
			filter,
		);

		return mergePermissions('or', permissions, filteredAppMinimalPermissions);
	}

	return permissions;
}
