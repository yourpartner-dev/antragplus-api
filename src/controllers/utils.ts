import { ForbiddenError, InvalidPayloadError, InvalidQueryError } from '../helpers/errors/index.js';
import argon2 from 'argon2';
import { Router } from 'express';
import Joi from 'joi';
import collectionExists from '../middleware/collection-exists.js';
import { respond } from '../middleware/respond.js';
import { RevisionsService } from '../services/revisions.js';
import { UtilsService } from '../services/utils.js';
import asyncHandler from '../helpers/utils/async-handler.js';
import { generateHash } from '../helpers/utils/generate-hash.js';
import { getDummyEmail } from '../helpers/utils/generate-dummy-email.js';

const router = Router();

const randomStringSchema = Joi.object<{ length: number }>({
	length: Joi.number().integer().min(1).max(500).default(32),
});

router.get(
	'/random/string',
	asyncHandler(async (req, res) => {
		const { nanoid } = await import('nanoid');

		const { error, value } = randomStringSchema.validate(req.query, { allowUnknown: true });

		if (error) throw new InvalidQueryError({ reason: error.message });

		return res.json({ data: nanoid(value.length) });
	}),
);

router.post(
	'/hash/generate',
	asyncHandler(async (req, res) => {
		if (!req.body?.string) {
			throw new InvalidPayloadError({ reason: `"string" is required` });
		}

		const hash = await generateHash(req.body.string);

		return res.json({ data: hash });
	}),
);

router.post(
	'/hash/verify',
	asyncHandler(async (req, res) => {
		if (!req.body?.string) {
			throw new InvalidPayloadError({ reason: `"string" is required` });
		}

		if (!req.body?.hash) {
			throw new InvalidPayloadError({ reason: `"hash" is required` });
		}

		const result = await argon2.verify(req.body.hash, req.body.string);

		return res.json({ data: result });
	}),
);

const SortSchema = Joi.object({
	item: Joi.alternatives(Joi.string(), Joi.number()).required(),
	to: Joi.alternatives(Joi.string(), Joi.number()).required(),
});

router.post(
	'/sort/:collection',
	collectionExists,
	asyncHandler(async (req, res) => {
		const { error } = SortSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.sort(req.collection, req.body);

		return res.status(200).end();
	}),
);

router.post(
	'/revert/:revision',
	asyncHandler(async (req, _res, next) => {
		const service = new RevisionsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.revert(req.params['revision']!);
		next();
	}),
	respond,
);

router.post(
	'/cache/clear',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const clearSystemCache = 'system' in req.query && (req.query['system'] === '' || Boolean(req.query['system']));

		await service.clearCache({ system: clearSystemCache });

		res.status(200).end();
	}),
);

const generateDummyEmailSchema = Joi.object({
	first_name: Joi.string().required(),
	domain: Joi.string().required(),
});

router.post(
	'/generate/dummy/email',
	asyncHandler(async (req, res) => {
		if (!req.accountability) {
			throw new ForbiddenError();
		}

		const { error } = generateDummyEmailSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const email = getDummyEmail(req.body.first_name, req.body.domain);
		return res.json({ data: email });
	}),
);

export default router;
