import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { streamText } from 'ai';
import { getOpenAIModel } from '../../services/ai/providers.js';
import { getNGOTools } from '../../services/ai/tools/ngo-tools.js';
import { ForbiddenError, InvalidPayloadError } from '../../helpers/errors/index.js';
import { useLogger } from '../../helpers/logger/index.js';
import type { Request, Response } from 'express';
import { ModelMessage, stepCountIs } from 'ai';
import { z } from 'zod';
const logger = useLogger();
const router = express.Router();

// Schema for NGO chat request
const ngoChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
  organization_id: z.string().optional(),
});

/**
 * NGO chat endpoint with streaming response
 * Handles natural conversation for adding/updating NGO information
 */
router.post(
  '/chat',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    const validation = ngoChatSchema.safeParse(req.body);
    if (!validation.success) {
      throw new InvalidPayloadError({ reason: validation.error.message });
    }
    
    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const { messages, organization_id } = validation.data;
    const userId = req.accountability?.user;

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    try {
      // Get NGO-specific tools
      const ngoTools = getNGOTools({
        userId: userId as string,
      });

      // Use only NGO tools for this specialized chat
      const tools = ngoTools;

      // Build system message for natural NGO conversation
      const systemMessage = `You are an NGO information assistant for AntragPlus. Your ONLY purpose is to help users add NGO information to the system.

IMPORTANT: You can ONLY help with NGO-related tasks. If users want to chat about other topics, politely redirect them to provide an NGO website URL or name.

When a user provides a website URL or NGO name:
- Use the searchNGOWebsite tool to find information
- Present findings in a clean, organized format
- List found fields with ✓ and missing fields with •
- Ask user to verify and provide missing information

Required information: NGO name, about/mission, location, contact email/phone (10+ digits), legal entity type, field of work, website, company size, typical funding amount.

Format responses concisely with clear sections for "Found" and "Still needed".

For any non-NGO requests, respond with: "I'm here specifically to help you add NGO information to AntragPlus. Please provide an NGO website URL or name to get started."

${organization_id ? `Note: You are updating existing organization ID: ${organization_id}` : ''}`;

      // Prepare messages with system context
      const messagesWithContext: ModelMessage[] = [
        { role: 'system', content: systemMessage },
        ...messages,
      ];
      // Stream the response with tools
      const result = streamText({
        model: getOpenAIModel(),
        messages: messagesWithContext,
        temperature: 0.7,
        tools,
        toolChoice: 'auto',
        // Stop after 3 steps or when no more tool calls are needed
        stopWhen: stepCountIs(5),
        onFinish: async (result) => {
          // Log the interaction
          try {
            logger.info('NGO chat interaction completed', {
              userId,
              organization_id,
              toolCalls: result.toolCalls?.length || 0,
              tokens: result.usage,
            });
          } catch (logError) {
            logger.error(logError, 'Failed to log NGO chat activity');
          }
        },
      });

      // Track accumulated extracted info across all tool calls
      let accumulatedExtractedInfo: any = {};
      
      // Stream both text and tool call events
      for await (const chunk of result.fullStream) {
        // Handle different chunk types
        if (chunk.type === 'text-delta') {
          // Stream text content
          res.write(`data: ${JSON.stringify({ 
            type: 'content',
            content: chunk.text 
          })}\n\n`);
        } else if (chunk.type === 'tool-call') {
          // Stream tool call information for UI feedback
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_call',
            tool: chunk.toolName,
            status: 'started'
          })}\n\n`);
        } else if (chunk.type === 'tool-result') {
          // Stream tool result status
          let currentExtractedInfo: any = undefined;
          
          if (chunk.toolName === 'searchNGOWebsite' 
            && typeof chunk.output === 'object' 
            && chunk.output !== null
            && 'extractedInfo' in chunk.output) {
            currentExtractedInfo = (chunk.output as any).extractedInfo;
            // Accumulate the extracted info
            if (currentExtractedInfo) {
              accumulatedExtractedInfo = { ...accumulatedExtractedInfo, ...currentExtractedInfo };
            }
          } else if (chunk.toolName === 'createOrUpdateNGO'
            && typeof chunk.output === 'object'
            && chunk.output !== null
            && 'success' in chunk.output
            && (chunk.output as any).success) {
            // Pass through the IDs when NGO is created/updated
            const ids = {
              organization_id: (chunk.output as any).organization_id,
              ngo_id: (chunk.output as any).ngo_id,
            };
            accumulatedExtractedInfo = { ...accumulatedExtractedInfo, ...ids };
          }
            
          // Always send the accumulated data
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_result',
            tool: chunk.toolName,
            status: 'completed',
            ...(Object.keys(accumulatedExtractedInfo).length > 0 && { extractedInfo: accumulatedExtractedInfo })
          })}\n\n`);
        }
      }

      // Send done event
      res.write(`event: done\n`);
      res.write(`data: [DONE]\n\n`);
      
    } catch (error) {
      logger.error(error, 'Error in NGO chat');
      
      // Send error event
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ 
        error: error instanceof Error ? error.message : 'An error occurred' 
      })}\n\n`);
    } finally {
      res.end();
    }
  })
);

// Removed extract endpoint - extraction happens via tools in the chat

export default router;