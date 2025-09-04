import { Router } from 'express';
import { getSchema } from '../helpers/utils/get-schema.js';
import { scheduleSynchronizedJob, validateCron } from '../helpers/utils/schedule.js';
import { createTusServer } from '../services/tus/index.js';
import { AuthorizationService } from '../services/authorization.js';
import asyncHandler from '../helpers/utils/async-handler.js';
import type { PermissionsAction } from '../types/index.js';
import { ForbiddenError } from '../helpers/errors/index.js';
import { RESUMABLE_UPLOADS } from '../constants.js';

const mapAction = (method: string): PermissionsAction => {
	switch (method) {
		case 'POST':
			return 'create';
		case 'PATCH':
			return 'update';
		case 'DELETE':
			return 'delete';
		default:
			return 'read';
	}
};

const checkFileAccess = asyncHandler(async (req, _res, next) => {
	const auth = new AuthorizationService({
		accountability: req.accountability,
		schema: req.schema,
	});

	if (!req.accountability?.admin) {
		const action = mapAction(req.method);

		if (action === 'create') {
			// checkAccess doesn't seem to work as expected for "create" actions
			const hasPermission = Boolean(
				req.accountability?.permissions?.find((permission) => {
					return permission.collection === 'yp_files' && permission.action === action;
				}),
			);

			if (!hasPermission) throw new ForbiddenError();
		} else {
			try {
				await auth.checkAccess(action, 'yp_files');
			} catch (e) {
				throw new ForbiddenError();
			}
		}
	}

	return next();
});

const handler = asyncHandler(async (req, res) => {
	const [tusServer, cleanupServer] = await createTusServer({
		schema: req.schema,
		accountability: req.accountability,
	});

	await tusServer.handle(req, res);

	cleanupServer();
});

export function scheduleTusCleanup() {
	if (!RESUMABLE_UPLOADS.ENABLED) return;

	if (validateCron(RESUMABLE_UPLOADS.SCHEDULE)) {
		scheduleSynchronizedJob('tus-cleanup', RESUMABLE_UPLOADS.SCHEDULE, async () => {
			const [tusServer, cleanupServer] = await createTusServer({
				schema: await getSchema(),
			});

			await tusServer.cleanUpExpiredUploads();

			cleanupServer();
		});
	}
}

const router = Router();

router.post('/', checkFileAccess, handler);
router.patch('/:id', checkFileAccess, handler);
router.delete('/:id', checkFileAccess, handler);

router.options('/:id', checkFileAccess, handler);
router.head('/:id', checkFileAccess, handler);

export default router;
