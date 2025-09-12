import { useLogger } from '../../../helpers/logger/index.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import { ForbiddenError } from '../../../helpers/errors/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

const logger = useLogger();

export interface VoteStatus {
  totalUpvotes: number;
  totalDownvotes: number;
  userVote: 'upvote' | 'downvote' | null;
}

export class MessageVoteService extends ItemsService {
  override accountability: Accountability | null;
  override schema: SchemaOverview;

  constructor(options: { accountability: Accountability | null; schema: SchemaOverview }) {
    super('message_votes', options);
    this.accountability = options.accountability;
    this.schema = options.schema;
  }

  /**
   * Vote on a message
   */
  async voteOnMessage(messageId: string, userId: string, isUpvote: boolean) {
    const knex = getDatabase();

    try {
      // First, verify the message exists and get its chat context
      const message = await knex('chat_messages')
        .select('chat_messages.*', 'chats.created_by as chat_owner', 'chats.visibility')
        .join('chats', 'chat_messages.chat_id', 'chats.id')
        .where('chat_messages.id', messageId)
        .first();

      if (!message) {
        throw new ForbiddenError();
      }

      // Check if user has access to this chat (following Vercel pattern)
      // User must either own the chat or chat must be public
      if (message.chat_owner !== userId && message.visibility !== 'public') {
        throw new ForbiddenError();
      }

      // Check if user already voted
      const existingVote = await knex('message_votes')
        .where('chat_message_id', messageId)
        .where('user_id', userId)
        .first();

      let result;
      if (existingVote) {
        // Update existing vote
        const updated = await knex('message_votes')
          .where('chat_message_id', messageId)
          .where('user_id', userId)
          .update({
            is_upvoted: isUpvote,
            updated_at: new Date(),
          })
          .returning('*');

        result = updated[0];
      } else {
        // Create new vote
        const created = await knex('message_votes')
          .insert({
            chat_message_id: messageId,
            user_id: userId,
            is_upvoted: isUpvote,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('*');

        result = created[0];
      }

      // Log activity to ai_activity_logs
      try {
        await knex('ai_activity_logs').insert({
          user_id: userId,
          activity_type: existingVote ? 'vote_updated' : 'vote_cast',
          entity_type: 'chat_messages',
          entity_id: messageId,
          description: `User ${existingVote ? 'updated' : 'cast'} ${isUpvote ? 'upvote' : 'downvote'} on message`,
          metadata: { 
            chat_id: message.chat_id,
            is_upvote: isUpvote,
            previous_vote: existingVote?.is_upvoted 
          },
          ip_address: this.accountability?.ip || null,
          user_agent: this.accountability?.userAgent || null,
          created_at: new Date()
        });
      } catch (logError) {
        // Don't throw - logging should not break voting
        logger.error(logError, 'Failed to log vote activity');
      }

      return result;
    } catch (error) {
      logger.error(error, 'Error voting on message');
      throw error;
    }
  }

  /**
   * Get vote status for a message
   */
  async getVoteStatus(messageId: string, userId: string | null): Promise<VoteStatus> {
    const knex = getDatabase();

    try {
      // Verify message exists (no access check needed for viewing vote counts)
      const message = await knex('chat_messages')
        .where('id', messageId)
        .first();

      if (!message) {
        throw new ForbiddenError();
      }

      // Get vote counts
      const voteCounts = await knex('message_votes')
        .where('chat_message_id', messageId)
        .select(
          knex.raw('COUNT(CASE WHEN is_upvoted = true THEN 1 END) as upvotes'),
          knex.raw('COUNT(CASE WHEN is_upvoted = false THEN 1 END) as downvotes')
        )
        .first();

      // Get user's vote if authenticated
      let userVote: 'upvote' | 'downvote' | null = null;
      if (userId) {
        const vote = await knex('message_votes')
          .where('chat_message_id', messageId)
          .where('user_id', userId)
          .first();

        if (vote) {
          userVote = vote.is_upvoted ? 'upvote' : 'downvote';
        }
      }

      return {
        totalUpvotes: parseInt(voteCounts?.upvotes || '0'),
        totalDownvotes: parseInt(voteCounts?.downvotes || '0'),
        userVote,
      };
    } catch (error) {
      logger.error(error, 'Error getting vote status');
      throw error;
    }
  }

  /**
   * Remove a vote from a message
   */
  async removeVote(messageId: string, userId: string): Promise<void> {
    const knex = getDatabase();

    try {
      // Verify the message exists and user has access (same as voting)
      const message = await knex('chat_messages')
        .select('chat_messages.*', 'chats.created_by as chat_owner', 'chats.visibility')
        .join('chats', 'chat_messages.chat_id', 'chats.id')
        .where('chat_messages.id', messageId)
        .first();

      if (!message) {
        throw new ForbiddenError();
      }

      // Check if user has access to this chat
      if (message.chat_owner !== userId && message.visibility !== 'public') {
        throw new ForbiddenError();
      }

      await knex('message_votes')
        .where('chat_message_id', messageId)
        .where('user_id', userId)
        .delete();
    } catch (error) {
      logger.error(error, 'Error removing vote');
      throw error;
    }
  }

  /**
   * Get all votes for a user
   */
  async getUserVotes(userId: string) {
    const knex = getDatabase();

    try {
      const votes = await knex('message_votes')
        .where('user_id', userId)
        .orderBy('created_at', 'desc');

      return votes;
    } catch (error) {
      logger.error(error, 'Error getting user votes');
      throw error;
    }
  }
}
