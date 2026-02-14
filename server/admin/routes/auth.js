/**
 * Admin auth: POST /login, GET /me
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { AdminUser } from '../schemas.js';
import { requireAdmin, signAdminToken } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';

const router = Router();
const SALT_ROUNDS = 12;

// POST /api/admin/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required.' });
    }
    const admin = await AdminUser.findOne({ email: email.trim().toLowerCase(), isActive: true });
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    admin.lastLoginAt = new Date();
    admin.lastLoginIp = req.ip || req.connection?.remoteAddress;
    await admin.save();

    const token = signAdminToken(admin._id.toString());
    res.json({
      success: true,
      token,
      admin: {
        _id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        permissions: admin.role === 'super_admin' ? ['*'] : (admin.permissions && admin.permissions.length ? admin.permissions : []),
      },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/admin/auth/me — requires Admin JWT
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
  });
});

export default router;
