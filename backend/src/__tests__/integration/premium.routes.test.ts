import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock premium service
vi.mock('../../services/premium.service', () => ({
  premiumService: {
    getHandles: vi.fn(),
    listAll: vi.fn(),
    add: vi.fn(),
    bulkAdd: vi.fn(),
    remove: vi.fn(),
  },
}));

// Mock auth service for authenticated routes
vi.mock('../../services/auth.service', () => ({
  __esModule: true,
  default: {
    verifyToken: vi.fn(),
  },
}));

import { premiumService } from '../../services/premium.service';
import authService from '../../services/auth.service';
import premiumRoutes from '../../routes/premium.routes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/premium-stores', premiumRoutes);
  return app;
}

const adminUser = {
  userId: '1', username: 'admin', email: 'admin@test.com', role: 'admin',
};

describe('Premium Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  describe('GET /api/premium-stores/handles', () => {
    it('should return handles without authentication (public)', async () => {
      (premiumService.getHandles as any).mockResolvedValue(['store-1', 'store-2']);

      const res = await request(app).get('/api/premium-stores/handles');

      expect(res.status).toBe(200);
      expect(res.body.handles).toEqual(['store-1', 'store-2']);
    });

    it('should return empty array when no premium stores', async () => {
      (premiumService.getHandles as any).mockResolvedValue([]);

      const res = await request(app).get('/api/premium-stores/handles');

      expect(res.status).toBe(200);
      expect(res.body.handles).toEqual([]);
    });
  });

  describe('GET /api/premium-stores', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/premium-stores');
      expect(res.status).toBe(401);
    });

    it('should return full list for authenticated admin', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);
      const mockStores = [
        { handle: 'store-1', addedAt: '2026-03-18T00:00:00.000Z', notes: 'VIP' },
        { handle: 'store-2', addedAt: '2026-03-17T00:00:00.000Z', notes: null },
      ];
      (premiumService.listAll as any).mockResolvedValue(mockStores);

      const res = await request(app)
        .get('/api/premium-stores')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.stores).toHaveLength(2);
      expect(res.body.stores[0].handle).toBe('store-1');
    });

    it('should return 403 for non-admin user', async () => {
      (authService.verifyToken as any).mockReturnValue({
        ...adminUser, role: 'viewer',
      });

      const res = await request(app)
        .get('/api/premium-stores')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/premium-stores', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/premium-stores')
        .send({ handle: 'store-1' });
      expect(res.status).toBe(401);
    });

    it('should add a premium store for admin', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);
      const mockEntry = { handle: 'store-1', addedAt: new Date().toISOString(), notes: 'Paid' };
      (premiumService.add as any).mockResolvedValue(mockEntry);

      const res = await request(app)
        .post('/api/premium-stores')
        .set('Authorization', 'Bearer valid-token')
        .send({ handle: 'store-1', notes: 'Paid' });

      expect(res.status).toBe(201);
      expect(res.body.handle).toBe('store-1');
    });

    it('should return 400 when handle is missing', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);

      const res = await request(app)
        .post('/api/premium-stores')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('handle');
    });
  });

  describe('POST /api/premium-stores/bulk', () => {
    it('should bulk add handles for admin', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);
      (premiumService.bulkAdd as any).mockResolvedValue({ added: 3 });

      const res = await request(app)
        .post('/api/premium-stores/bulk')
        .set('Authorization', 'Bearer valid-token')
        .send({ handles: ['s1', 's2', 's3'], notes: 'Batch' });

      expect(res.status).toBe(201);
      expect(res.body.added).toBe(3);
    });

    it('should return 400 when handles is not an array', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);

      const res = await request(app)
        .post('/api/premium-stores/bulk')
        .set('Authorization', 'Bearer valid-token')
        .send({ handles: 'not-an-array' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/premium-stores/:handle', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).delete('/api/premium-stores/store-1');
      expect(res.status).toBe(401);
    });

    it('should remove a premium store for admin', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);
      (premiumService.remove as any).mockResolvedValue(true);

      const res = await request(app)
        .delete('/api/premium-stores/store-1')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(true);
    });

    it('should return 404 when handle not found', async () => {
      (authService.verifyToken as any).mockReturnValue(adminUser);
      (premiumService.remove as any).mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/premium-stores/nonexistent')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(404);
    });
  });
});
