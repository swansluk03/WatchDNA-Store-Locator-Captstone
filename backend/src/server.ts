import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Import configuration
import { config, validateConfig } from './config';
import { logger } from './utils/logger';

// Validate configuration on startup
validateConfig();

// Import middleware
import { authLimiter, publicLimiter, uploadLimiter, scraperLimiter } from './middleware/rateLimiter';
import { securityHeaders } from './middleware/security';

// Import routes
import authRoutes from './routes/auth.routes';
import uploadRoutes from './routes/upload.routes';
import scraperRoutes from './routes/scraper.routes';
import locationRoutes from './routes/location.routes';
import healthRoutes from './routes/health.routes';
import premiumRoutes from './routes/premium.routes';

const app: Express = express();
const PORT = config.port;

// Trust proxy (required for Railway/Render to get real client IP)
app.set('trust proxy', 1);

// CORS Configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (config.cors.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS policy`));
    }
  },
  credentials: true, // Allow cookies and Authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 600, // Cache preflight requests for 10 minutes
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Apply security headers
app.use(securityHeaders);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Health check routes (no rate limiting)
app.use('/health', healthRoutes);

// Apply rate limiters to specific routes
// Note: More specific routes must come BEFORE general routes
app.use('/api/auth/login', authLimiter); // Strict: 5 attempts per 15 min
app.use('/api/uploads', uploadLimiter); // 10 uploads per hour
app.use('/api/locations', publicLimiter); // Lenient: 300 requests per 15 min

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/premium-stores', premiumRoutes);

// Serve user-frontend static files
const userFrontendDir = path.join(__dirname, '..', '..', 'user-frontend');
const uploadsDir = path.join(__dirname, '..', 'uploads');
app.use(express.static(userFrontendDir));

// expose backend/uploads so prototype.html can fetch store data
app.use('/backend/uploads', express.static(uploadsDir));

// Redirect root to prototype.html
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(userFrontendDir, 'prototype.html'));
});

// 404 handler for API routes only
app.use('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'API route not found' });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(config.isDevelopment && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  logger.warn(`🚀 Server running on port ${PORT} | env=${config.nodeEnv} | origins=${config.cors.allowedOrigins.join(', ')}`);
});

export default app;
