import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes';
import uploadRoutes from './routes/upload.routes';
import scraperRoutes from './routes/scraper.routes';
import locationRoutes from './routes/location.routes';

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'WatchDNA Admin Backend'
  });
});

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
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
});

export default app;
