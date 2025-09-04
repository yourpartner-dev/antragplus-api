import type { Filter, FilterOperator } from './filter.js';
import type { DeepPartial } from './misc.js';

type Translations = {
	language: string;
	translation: string;
};

export type Width = 'half' | 'half-left' | 'half-right' | 'full' | 'fill';

export interface Column {
	name: string;
	table: string;
	data_type: string;
	default_value: string | number | boolean | null;
	max_length: number | null;
	numeric_precision: number | null;
	numeric_scale: number | null;

	is_nullable: boolean;
	is_unique: boolean;
	is_primary_key: boolean;
	is_generated: boolean;
	generation_expression?: string | null;
	has_auto_increment: boolean;
	foreign_key_table: string | null;
	foreign_key_column: string | null;

	// Not supported in SQLite or MSSQL
	comment?: string | null;

	// Postgres Only
	schema?: string;
	foreign_key_schema?: string | null;
}


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

export const NUMERIC_TYPES = ['bigInteger', 'decimal', 'float', 'integer'] as const;

export const GEOMETRY_TYPES = [
	'Point',
	'LineString',
	'Polygon',
	'MultiPoint',
	'MultiLineString',
	'MultiPolygon',
] as const;

export const GEOMETRY_FORMATS = ['native', 'geojson', 'wkt', 'lnglat'] as const;

export const LOCAL_TYPES = [
	'standard',
	'file',
	'files',
	'm2o',
	'o2m',
	'm2m',
	'm2a',
	'presentation',
	'translations',
	'group',
] as const;

export const RELATIONAL_TYPES = [
	'file',
	'files',
	'm2o',
	'o2m',
	'm2m',
	'm2a',
	'presentation',
	'translations',
	'group',
] as const;

export const FUNCTIONS = ['year', 'month', 'week', 'day', 'weekday', 'hour', 'minute', 'second', 'count'] as const;

export type Type = (typeof TYPES)[number];

export type FieldFunction = (typeof FUNCTIONS)[number];

export type LocalType = (typeof LOCAL_TYPES)[number];

export type NumericValue = number | bigint;
export type NumericType = (typeof NUMERIC_TYPES)[number];

export type GeometryType = (typeof GEOMETRY_TYPES)[number] | 'GeometryCollection' | undefined;

export type GeometryFormat = (typeof GEOMETRY_FORMATS)[number];

export type FieldMeta = {
	id: number;
	collection: string;
	field: string;
	group: string | null;
	hidden: boolean;
	interface: string | null;
	display: string | null;
	options: Record<string, any> | null;
	display_options: Record<string, any> | null;
	readonly: boolean;
	required: boolean;
	sort: number | null;
	special: string[] | null;
	translations: Translations[] | null;
	width: Width | null;
	note: string | null;
	conditions: Condition[] | null;
	validation: Filter | null;
	validation_message: string | null;
	system?: true;
};

export interface FieldRaw {
	collection: string;
	field: string;
	type: Type;
	schema: Column | null;
	meta: FieldMeta | null;
}

export interface Field extends FieldRaw {
	name: string;
	children?: Field[] | null;
}

export type RawField = DeepPartial<Field> & { field: string; type: Type };

export type ValidationError = {
	code: string;
	collection: string;
	field: string;
	type: FilterOperator;
	hidden?: boolean;
	group: string | null;
	valid?: number | string | (number | string)[];
	invalid?: number | string | (number | string)[];
	substring?: string;
};

export type Condition = {
	name: string;
	rule: Record<string, any>;

	readonly?: boolean;
	hidden?: boolean;
	options?: Record<string, any>;
	required?: boolean;
};


export interface FieldRaw {
	collection: string;
	field: string;
	type: Type;
	schema: Column | null;
	meta: FieldMeta | null;
}

export interface Field extends FieldRaw {
	name: string;
	children?: Field[] | null;
}
