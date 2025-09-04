import { useBus } from '../../bus/index.js';
import emitter from '../../emitter.js';
import type { WebSocketEvent } from '../messages.js';

let actionsRegistered = false;

export function registerWebSocketEvents() {
	if (actionsRegistered) return;
	actionsRegistered = true;

	registerActionHooks([
		'items',
		'activity',
		'notifications',
		'permissions',
		'revisions',
		'roles',
		'users',
		'versions',
	]);

	registerFilesHooks();
	registerSortHooks();
}

function registerActionHooks(modules: string[]) {
	// register event hooks that can be handled in an uniform manner
	for (const module of modules) {
		registerAction(module + '.create', ({ key, collection, payload = {} }) => ({
			collection,
			action: 'create',
			key,
			payload,
		}));

		registerAction(module + '.update', ({ keys, collection, payload = {} }) => ({
			collection,
			action: 'update',
			keys,
			payload,
		}));

		registerAction(module + '.delete', ({ keys, collection, payload = [] }) => ({
			collection,
			action: 'delete',
			keys,
			payload,
		}));
	}
}
function registerFilesHooks() {
	// extra event for file uploads that doubles as create event
	registerAction('files.upload', ({ key, collection, payload = {} }) => ({
		collection,
		action: 'create',
		key,
		payload,
	}));

	registerAction('files.update', ({ keys, collection, payload = {} }) => ({
		collection,
		action: 'update',
		keys,
		payload,
	}));

	registerAction('files.delete', ({ keys, collection, payload = [] }) => ({
		collection,
		action: 'delete',
		keys,
		payload,
	}));
}

function registerSortHooks() {
	registerAction('items.sort', ({ collection, item }) => ({
		collection,
		action: 'update',
		keys: [item],
		payload: {},
	}));
}

/**
 * Wrapper for emitter.onAction to hook into system events
 * @param event The action event to watch
 * @param transform Transformer function
 */
function registerAction(event: string, transform: (args: Record<string, any>) => WebSocketEvent) {
	const messenger = useBus();

	emitter.onAction(event, (data: Record<string, any>) => {
		// push the event through the Redis pub/sub
		messenger.publish('websocket.event', transform(data) as Record<string, any>);
	});
}
