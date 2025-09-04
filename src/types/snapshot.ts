import type { Field, FieldMeta, Relation, RelationMeta } from './index.js';
import type { DatabaseClient } from './database.js';

export type Snapshot = {
	version: number;
	yourpartner: string;
	vendor?: DatabaseClient;
	collections: any[];
	fields: SnapshotField[];
	relations: SnapshotRelation[];
};

export type SnapshotField = Field & { meta: Omit<FieldMeta, 'id'> };
export type SnapshotRelation = Relation & { meta: Omit<RelationMeta, 'id'> };

export type SnapshotWithHash = Snapshot & { hash: string };

/**
 * Indicates the kind of change based on comparisons by deep-diff package
 */
export const DiffKind = {
	/** indicates a newly added property/element */
	NEW: 'N',
	/** indicates a property/element was deleted */
	DELETE: 'D',
	/** indicates a property/element was edited */
	EDIT: 'E',
	/** indicates a change occurred within an array */
	ARRAY: 'A',
} as const;
