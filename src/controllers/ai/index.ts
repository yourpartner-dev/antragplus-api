import { Router } from 'express';
import chatRouter from './chat.js';
import embeddingsRouter from './embeddings.js';
import historyRouter from './history.js';
import suggestionsRouter from './suggestions.js';
import voteRouter from './vote.js';
import ngoChatRouter from './ngo-chat.js';
import applicationsRouter from './applications.js';

const router = Router();

// Mount all AI routes
router.use('/chat', chatRouter);
router.use('/ngo', ngoChatRouter);
router.use('/embeddings', embeddingsRouter);
router.use('/history', historyRouter);
router.use('/suggestions', suggestionsRouter);
router.use('/messages', voteRouter); // Vote routes are under /messages/:messageId/vote
router.use('/applications', applicationsRouter); // Enhanced application generation

export default router;