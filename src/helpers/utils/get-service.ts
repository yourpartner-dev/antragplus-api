import { ForbiddenError } from '../../helpers/errors/index.js';
import {
	ActivityService,
	FilesService,
	ItemsService,
	NotificationsService,
	PermissionsService,
	RevisionsService,
	RolesService,
	UsersService,
} from '../../services/index.js';
import type { AbstractServiceOptions } from '../../types/services.js';

/**
 * Select the correct service for the given collection. This allows the individual services to run
 * their custom checks (f.e. it allows `UsersService` to prevent updating TFA secret from outside).
 */
export function getService(collection: string, opts: AbstractServiceOptions): ItemsService {
	switch (collection) {
		case 'yp_activity':
			return new ActivityService(opts);
		case 'yp_files':
			return new FilesService(opts);
		case 'yp_notifications':
			return new NotificationsService(opts);
		case 'yp_permissions':
			return new PermissionsService(opts);
		case 'yp_revisions':
			return new RevisionsService(opts);
		case 'yp_roles':
			return new RolesService(opts);
		case 'yp_users':
			return new UsersService(opts);
		default:
			// Deny usage of other system collections via ItemsService
			if (collection.startsWith('yp_')) throw new ForbiddenError();

			return new ItemsService(collection, opts);
	}
}
