/**
 * RBAC: requireAdmin (JWT), requirePermission(permission)
 * Role-to-permissions map; super_admin bypasses.
 */

import jwt from 'jsonwebtoken';
import { AdminUser } from '../schemas.js';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'change-me-admin-secret';

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  game_admin: ['gameplay:read', 'gameplay:write', 'scenes:read', 'scenes:write', 'themes:read', 'themes:write'],
  content_admin: ['scenes:read', 'scenes:write', 'themes:read', 'themes:write', 'gameplay:read'],
  support_admin: ['users:read', 'users:write', 'users:ban', 'hints:read', 'hints:grant', 'referrals:read', 'dailycheckin:read', 'dailycheckin:write', 'leaderboard:read'],
  finance_admin: ['shop:read', 'shop:write', 'payments:refund', 'referrals:read', 'referrals:write', 'referrals:revoke', 'analytics:read', 'users:read'],
};

function getPermissions(admin) {
  if (admin.role === 'super_admin') return ['*'];
  const rolePerms = ROLE_PERMISSIONS[admin.role] || [];
  const override = admin.permissions && admin.permissions.length ? admin.permissions : rolePerms;
  return override;
}

function hasPermission(admin, required) {
  const perms = getPermissions(admin);
  if (perms.includes('*')) return true;
  return perms.includes(required);
}

/**
 * Verify Admin JWT and attach req.admin (plain object with _id, email, role, permissions, name).
 */
export function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin token required.' });
  }
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    AdminUser.findById(decoded.adminId)
      .then((admin) => {
        if (!admin || !admin.isActive) {
          return res.status(401).json({ success: false, message: 'Admin account disabled or not found.' });
        }
        req.admin = {
          _id: admin._id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          permissions: getPermissions(admin),
        };
        next();
      })
      .catch((err) => {
        console.error('Admin lookup error:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
      });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
  }
}

/**
 * Require one of the given permissions. Use after requireAdmin.
 */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ success: false, message: 'Admin required.' });
    const allowed = permissions.some((p) => hasPermission(req.admin, p));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Insufficient permission.' });
    }
    next();
  };
}

export function getJwtSecret() {
  return ADMIN_JWT_SECRET;
}

export function signAdminToken(adminId) {
  return jwt.sign(
    { adminId, purpose: 'admin' },
    ADMIN_JWT_SECRET,
    { expiresIn: process.env.ADMIN_JWT_EXPIRY || '8h' }
  );
}
