import type { PrimaryKey } from './items.js';

export type Notification = {
	id: string;
	status: string;
	timestamp: string;
	recipient: string;
	sender: string | null;
	subject: string;
	message: string | null;
	collection: string | null;
	item: PrimaryKey | null;
	params?: any;
	organization_id: string | null;
	language: 'de-DE' | 'en-US';
};