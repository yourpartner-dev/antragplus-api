/**
 * Check if requested collection exists, and save it to req.collection
 */

import type { RequestHandler } from 'express';
import { ForbiddenError } from '../helpers/errors/index.js';
import { systemCollectionRows } from '../helpers/system-data/index.js';
import asyncHandler from '../helpers/utils/async-handler.js';

const collectionExists: RequestHandler = asyncHandler(async (req, _res, next) => {
	if (!req.params['collection']) return next();
	
	if (req.params['collection'] in req.schema.collections === false) {
		throw new ForbiddenError();
	}

	req.collection = req.params['collection'];

	const systemCollectionRow = systemCollectionRows.find((collection) => {
		return collection?.collection === req.collection;
	});

	if (systemCollectionRow !== undefined) {
		req.singleton = !!systemCollectionRow?.singleton;
	} else {
		req.singleton = req.schema.collections[req.collection]?.singleton ?? false;
	}

	return next();
});

export default collectionExists;
