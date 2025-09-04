import type { Accountability, SchemaOverview } from '../../types/index.js';
import { MetaService } from '../../services/index.js';
import { getService } from '../../helpers/utils/get-service.js';
import type { WebSocketEvent } from '../messages.js';
import type { Subscription } from '../types.js';

type PSubscription = Omit<Subscription, 'client'>;

/**
 * Get items from a collection using the appropriate service
 *
 * @param subscription Subscription object
 * @param accountability Accountability object
 * @param schema Schema object
 * @param event Event data
 * @returns the fetched items
 */
export async function getPayload(
	subscription: PSubscription,
	accountability: Accountability | null,
	schema: SchemaOverview,
	event?: WebSocketEvent,
): Promise<Record<string, any>> {
	const metaService = new MetaService({ schema, accountability });

	const result: Record<string, any> = {
		event: event?.action ?? 'init',
	};
	
	result['data'] = await getItemsPayload(subscription, accountability, schema, event);

	const query = subscription.query ?? {};

	if ('meta' in query) {
		result['meta'] = await metaService.getMetaForQuery(subscription.collection, query);
	}

	return result;
}

/**
 * Get items from a collection using the appropriate service
 *
 * @param subscription Subscription object
 * @param accountability Accountability object
 * @param schema Schema object
 * @param event Event data
 * @returns the fetched data
 */
export async function getItemsPayload(
	subscription: PSubscription,
	accountability: Accountability | null,
	schema: SchemaOverview,
	event?: WebSocketEvent,
) {
	const query = subscription.query ?? {};
	const service = getService(subscription.collection, { schema, accountability });

	if ('item' in subscription) {
		if (event?.action === 'delete') {
			// return only the subscribed id in case a bluk delete was done
			return subscription.item;
		} else {
			return await service.readOne(subscription.item, query);
		}
	}

	switch (event?.action) {
		case 'create':
			return await service.readMany([event.key], query);
		case 'update':
			return await service.readMany(event.keys, query);
		case 'delete':
			return event.keys;
		case undefined:
		default:
			return await service.readByQuery(query);
	}
}
