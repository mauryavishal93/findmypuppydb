import { Router } from 'express';

const router = Router();

// Placeholder health check for admin API (RBAC can be added later)
router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Admin API is available.' });
});

export default router;
