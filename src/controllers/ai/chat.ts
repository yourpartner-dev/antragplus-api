import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { ChatService } from '../../services/ai/chat/chat-service.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import type { Accountability } from '../../types/accountability.js';
import type { SchemaOverview } from '../../types/schema.js';

import {
  createChatSchema,
  updateChatSchema,
  addMessageSchema,
  listChatsSchema,
  getMessagesSchema,
} from './schemas/chat.schema.js';
import { ForbiddenError, InvalidPayloadError } from '../../helpers/errors/index.js';
import { isValidUuid } from '../../helpers/utils/is-valid-uuid.js';

const router = express.Router();

/**
 * Create a new chat conversation with streaming response
 * Compatible with Vercel AI SDK
 * Note: This endpoint handles its own response streaming, so no respond middleware
 */

router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    // Validate request body
    const { error, value } = createChatSchema.validate(req.body);
    if (error) {
      throw new InvalidPayloadError({ reason: error.message });
    }

    if(!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const { messages, context, model, temperature } = value;
    const accountability = req.accountability;
    const userId = accountability?.user;
    const schema = req.schema;

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    // Initialize service with accountability and schema
    const service = new ChatService({
      accountability: accountability as Accountability,
      schema: schema as SchemaOverview,
    });

    // Create or get chat
    const chat = await service.createOrGetChat({
      messages,
      userId: userId as string,
      context,
      model: model || 'gpt-5-nano-2025-08-07',
      temperature: temperature || 0.7,
    });

    // Set payload for the chat creation response
    res.locals['payload'] = { data: chat };

    // Stream the response
    await service.streamChatResponse({
      chatId: chat.id,
      messages,
      context,
      model: model || 'gpt-5-nano-2025-08-07',
      temperature: temperature || 0.7,
      stream: res,
    });

    // End the response after streaming is complete
    res.end();
    return next();
  })
);

/**
 * Get all chats for the authenticated user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate query parameters
    const { error } = listChatsSchema.validate(req.query);
    if (error) {
      throw new InvalidPayloadError({ reason: error.message });
    }

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    const chats = await service.getUserChats(req.accountability.user as string);

    res.locals['payload'] = { data: chats };
    return next();
  }),
  respond
);

/**
 * Get a specific chat with messages
 */
router.get(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { chatId } = req.params;

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    if(!chatId || !isValidUuid(chatId)) {
      throw new InvalidPayloadError({ reason: "Chat ID missing or not valid"});
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    const chat = await service.getChat(chatId, req.accountability.user as string);  

    if (!chat) {
      return res.status(404).json({
        errors: [{ message: 'Chat not found' }],
      });
    }

    res.locals['payload'] = { data: chat };
    return next();
  }),
  respond
);

/**
 * Update chat metadata (e.g., title)
 */
router.patch(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { chatId } = req.params;

    // Validate request body
    const { error, value } = updateChatSchema.validate(req.body);
    if (error) {
      throw new InvalidPayloadError({ reason: error.message });
    }

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    if(!chatId || !isValidUuid(chatId)) {
      throw new InvalidPayloadError({ reason: "Chat ID missing or not valid"});
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    const updatedChat = await service.updateChat(
      chatId,
      value,
      req.accountability.user as string
    );

    res.locals['payload'] = { data: updatedChat };
    return next();
  }),
  respond
);

/**
 * Delete a chat conversation
 */
router.delete(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { chatId } = req.params;

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    if(!chatId || !isValidUuid(chatId)) {
      throw new InvalidPayloadError({ reason: "Chat ID missing or not valid"});
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    await service.deleteChat(chatId, req.accountability.user as string);

    res.locals['payload'] = { data: { success: true } };
    return next();
  }),
  respond
);

/**
 * Get messages for a specific chat
 */
router.get(
  '/:chatId/messages',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { chatId } = req.params;

    // Validate query parameters
    const { error } = getMessagesSchema.validate(req.query);
    if (error) {
      throw new InvalidPayloadError({ reason: error.message });
    }

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    if(!chatId || !isValidUuid(chatId)) {
      throw new InvalidPayloadError({ reason: "Chat ID missing or not valid"});
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    const messages = await service.getChatMessages(
      chatId,
      req.accountability.user as string
    );

    res.locals['payload'] = { data: messages };
    return next();
  }),
  respond
);

/**
 * Send a new message in a chat (non-streaming)
 */
router.post(
  '/:chatId/messages',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { chatId } = req.params;

    // Validate request body
    const { error, value } = addMessageSchema.validate(req.body);
    if (error) {
      throw new InvalidPayloadError({ reason: error.message });
    }

    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    if(!chatId || !isValidUuid(chatId)) {
      throw new InvalidPayloadError({ reason: "Chat ID missing or not valid"});
    }

    const service = new ChatService({
      accountability: req.accountability as Accountability,
      schema: req.schema as SchemaOverview,
    });

    const message = await service.addMessage(
      chatId,
      value,
      req.accountability.user as string
    );

    res.locals['payload'] = { data: message };
    return next();
  }),
  respond
);

export default router;
