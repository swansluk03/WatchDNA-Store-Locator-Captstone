import { Request, Response } from 'express';
import authService from '../services/auth.service';

export class AuthController {

  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const result = await authService.login({ username, password });

      res.json({
        success: true,
        ...result
      });

    } catch (error: any) {
      console.error('Login error:', error);

      if (error.message === 'Invalid username or password') {
        return res.status(401).json({ error: error.message });
      }

      res.status(500).json({ error: 'Login failed' });
    }
  }

  async logout(req: Request, res: Response) {
    // For JWT, logout is handled client-side by removing the token
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }

  async me(req: Request, res: Response) {
    try {
      // User is attached by auth middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await authService.getUserById(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user });

    } catch (error: any) {
      console.error('Get user error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async listUsers(req: Request, res: Response) {
    try {
      const users = await authService.listUsers();
      res.json({ users });
    } catch (error: any) {
      console.error('List users error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new AuthController();
