// Vercel serverless function entry point
import createApp from '../dist/app.js';

let app;

export default async function handler(req, res) {
  // Initialize app only once (cold start optimization)
  if (!app) {
    app = await createApp();
  }

  // Handle the request using Express app
  return app(req, res);
}