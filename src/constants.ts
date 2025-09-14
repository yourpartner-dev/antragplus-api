import type { CookieOptions } from 'express';
import type { TransformationParams } from './types/index.js';
import { getMilliseconds } from './helpers/utils/get-milliseconds.js';
import bytes from 'bytes';
import { DEFAULTS } from './helpers/env/constants/defaults.js';

export const SYSTEM_ASSET_ALLOW_LIST: TransformationParams[] = [
	{
		key: 'system-small-cover',
		format: 'auto',
		transforms: [['resize', { width: 64, height: 64, fit: 'cover' }]],
	},
	{
		key: 'system-small-contain',
		format: 'auto',
		transforms: [['resize', { width: 64, fit: 'contain' }]],
	},
	{
		key: 'system-medium-cover',
		format: 'auto',
		transforms: [['resize', { width: 300, height: 300, fit: 'cover' }]],
	},
	{
		key: 'system-medium-contain',
		format: 'auto',
		transforms: [['resize', { width: 300, fit: 'contain' }]],
	},
	{
		key: 'system-large-cover',
		format: 'auto',
		transforms: [['resize', { width: 800, height: 800, fit: 'cover' }]],
	},
	{
		key: 'system-large-contain',
		format: 'auto',
		transforms: [['resize', { width: 800, fit: 'contain' }]],
	},
];
export const ASSET_TRANSFORM_QUERY_KEYS = [
	'key',
	'transforms',
	'width',
	'height',
	'format',
	'fit',
	'quality',
	'withoutEnlargement',
	'focal_point_x',
	'focal_point_y',
] as const satisfies Readonly<(keyof TransformationParams)[]>;

export const FILTER_VARIABLES = ['$NOW', '$CURRENT_USER', '$CURRENT_ROLE'];

export const ALIAS_TYPES = ['alias', 'o2m', 'm2m', 'm2a', 'o2a', 'files', 'translations'];

export const DEFAULT_AUTH_PROVIDER = 'default';

export const COLUMN_TRANSFORMS = ['year', 'month', 'day', 'weekday', 'hour', 'minute', 'second'];

export const GENERATE_SPECIAL = ['uuid', 'date-created', 'role-created', 'user-created'];

export const UUID_REGEX = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';


export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
	httpOnly: true,
	domain: process.env['REFRESH_TOKEN_COOKIE_DOMAIN'] || DEFAULTS.REFRESH_TOKEN_COOKIE_DOMAIN as string | undefined,
	maxAge: getMilliseconds(process.env['REFRESH_TOKEN_TTL'] || DEFAULTS.REFRESH_TOKEN_TTL),
	secure: Boolean(process.env['REFRESH_TOKEN_COOKIE_SECURE'] || DEFAULTS.REFRESH_TOKEN_COOKIE_SECURE),
	sameSite: (process.env['REFRESH_TOKEN_COOKIE_SAME_SITE'] || (DEFAULTS.REFRESH_TOKEN_COOKIE_SAME_SITE || 'strict')) as 'lax' | 'strict' | 'none',
};

export const SESSION_COOKIE_OPTIONS: CookieOptions = {
	httpOnly: true,
	domain: process.env['SESSION_COOKIE_DOMAIN'] || DEFAULTS.SESSION_COOKIE_DOMAIN as string | undefined,
	maxAge: getMilliseconds(process.env['SESSION_COOKIE_TTL'] || DEFAULTS.SESSION_COOKIE_TTL || DEFAULTS.REFRESH_TOKEN_TTL),
	secure: Boolean(process.env['SESSION_COOKIE_SECURE'] || DEFAULTS.SESSION_COOKIE_SECURE !== undefined ? DEFAULTS.SESSION_COOKIE_SECURE : DEFAULTS.REFRESH_TOKEN_COOKIE_SECURE),
	sameSite: (process.env['SESSION_COOKIE_SAME_SITE'] || DEFAULTS.SESSION_COOKIE_SAME_SITE || DEFAULTS.REFRESH_TOKEN_COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
};

export const OAS_REQUIRED_SCHEMAS = ['Query', 'x-metadata'];

/** Formats from which transformation is supported */
export const SUPPORTED_IMAGE_TRANSFORM_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif'];

/** Formats where metadata extraction is supported */
export const SUPPORTED_IMAGE_METADATA_FORMATS = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/tiff',
	'image/avif',
];

/** Resumable uploads */
export const RESUMABLE_UPLOADS = {
	ENABLED: DEFAULTS.TUS_ENABLED as boolean,
	CHUNK_SIZE: bytes.parse(DEFAULTS.TUS_CHUNK_SIZE),
	MAX_SIZE: bytes.parse(DEFAULTS.FILES_MAX_UPLOAD_SIZE),
	EXPIRATION_TIME: getMilliseconds(DEFAULTS.TUS_UPLOAD_EXPIRATION, 600_000 /* 10min */),
	SCHEDULE: String(DEFAULTS.TUS_CLEANUP_SCHEDULE),
};

/* Default settings for DECIMAL type */
export const DEFAULT_NUMERIC_PRECISION = 10;
export const DEFAULT_NUMERIC_SCALE = 5;

/* Extremes for big integer type */
export const MAX_SAFE_INT64 = 2n ** 63n - 1n;
export const MIN_SAFE_INT64 = (-2n) ** 63n;

/* Extremes for integer type */
export const MAX_SAFE_INT32 = 2 ** 31 - 1;
export const MIN_SAFE_INT32 = (-2) ** 31;

export const KNEX_TYPES = [
	'bigInteger',
	'boolean',
	'date',
	'dateTime',
	'decimal',
	'float',
	'integer',
	'json',
	'string',
	'text',
	'time',
	'timestamp',
	'binary',
	'uuid',
] as const;

export const TYPES = [
	...KNEX_TYPES,
	'alias',
	'hash',
	'csv',
	'geometry',
	'geometry.Point',
	'geometry.LineString',
	'geometry.Polygon',
	'geometry.MultiPoint',
	'geometry.MultiLineString',
	'geometry.MultiPolygon',
	'unknown',
] as const;

export const JAVASCRIPT_FILE_EXTS = ['js', 'mjs', 'cjs'] as const;

export enum Action {
	CREATE = 'create',
	UPDATE = 'update',
	DELETE = 'delete',
	REVERT = 'revert',
	VERSION_SAVE = 'version_save',
	COMMENT = 'comment',
	UPLOAD = 'upload',
	LOGIN = 'login',
	RUN = 'run',
	INSTALL = 'install',
}

export const FUNCTIONS = ['year', 'month', 'week', 'day', 'weekday', 'hour', 'minute', 'second', 'count'] as const;

export const REGEX_BETWEEN_PARENS = /\(([^)]+)\)/;

export const version: string = '1.0.0';