import type { RequestHandler } from 'express';
import asyncHandler from '../helpers/utils/async-handler.js';
import { getSchema } from '../helpers/utils/get-schema.js';

const schema: RequestHandler = asyncHandler(async (req, _res, next) => {
	req.schema = await getSchema();
	return next();
});

export default schema;
