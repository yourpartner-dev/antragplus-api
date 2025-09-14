// Vercel serverless function entry point
import createApp from '../dist/app.js';

let app;

export default async function handler(req, res) {
  try {
    // Initialize app only once (cold start optimization)
    if (!app) {
      console.log('Initializing app...');
      app = await createApp();
      console.log('App initialized successfully');
    }

    // Handle the request using Express app
    return app(req, res);
  } catch (error) {
    console.error('Error in handler:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}