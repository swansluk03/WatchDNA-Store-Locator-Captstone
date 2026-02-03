import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Import configuration
import { config, validateConfig } from './config';

// Validate configuration on startup
validateConfig();

// Import middleware
import { authLimiter, publicLimiter, uploadLimiter, scraperLimiter } from './middleware/rateLimiter';

// Import routes
import authRoutes from './routes/auth.routes';
import uploadRoutes from './routes/upload.routes';
import scraperRoutes from './routes/scraper.routes';
import locationRoutes from './routes/location.routes';

const app: Express = express();
const PORT = config.port;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Health check (no rate limiting)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'WatchDNA Admin Backend'
  });
});

// Apply rate limiters to specific routes
// Note: More specific routes must come BEFORE general routes
app.use('/api/auth/login', authLimiter); // Strict: 5 attempts per 15 min
app.use('/api/uploads', uploadLimiter); // 10 uploads per hour
app.use('/api/scraper', scraperLimiter); // 20 jobs per hour
app.use('/api/locations', publicLimiter); // Lenient: 300 requests per 15 min

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/locations', locationRoutes);

// Serve static files (prototype.html and locations.csv)
const staticDir = path.join(__dirname, '..', '..');
app.use(express.static(staticDir));

// Redirect root to prototype.html
app.get('/', (req: Request, res: Response) => {
  res.redirect('/prototype.html');
});

// 404 handler for API routes only
app.use('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'API route not found' });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(config.isDevelopment && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${config.nodeEnv}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`🔐 JWT expires in: ${config.auth.jwtExpiresIn}`);
  console.log(`🌍 CORS allowed origins: ${config.cors.allowedOrigins.join(', ')}`);
  console.log(`⚡ Rate limiting: ${config.isDevelopment ? 'DISABLED (dev mode)' : 'ENABLED'}`);
});

export default app;
