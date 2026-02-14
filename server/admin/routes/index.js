/**
 * Mount all admin routes under /api/admin
 * Auth at /api/admin/auth, dashboard at /api/admin/dashboard, etc.
 */

import { Router } from 'express';
import auth from './auth.js';
import dashboard from './dashboard.js';
import users from './users.js';
import gameplay from './gameplay.js';
import security from './security.js';
import shop from './shop.js';
import maintenance from './maintenance.js';

const router = Router();

router.use('/auth', auth);
router.use('/dashboard', dashboard);
router.use('/users', users);
router.use('/gameplay', gameplay);
router.use('/security', security);
router.use('/shop', shop);
router.use('/maintenance', maintenance);

// Placeholder routes (return 501 until implemented)
const notImplemented = (req, res) => res.status(501).json({ success: false, message: 'Not implemented yet.' });

router.use('/scenes', (req, res, next) => notImplemented(req, res));
router.use('/hints', (req, res, next) => notImplemented(req, res));
router.use('/referrals', (req, res, next) => notImplemented(req, res));
router.use('/dailycheckin', (req, res, next) => notImplemented(req, res));
router.use('/leaderboard', (req, res, next) => notImplemented(req, res));
router.use('/themes', (req, res, next) => notImplemented(req, res));
router.use('/notifications', (req, res, next) => notImplemented(req, res));
router.use('/analytics', (req, res, next) => notImplemented(req, res));

export default router;
