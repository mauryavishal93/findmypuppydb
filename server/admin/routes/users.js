/**
 * Admin user management: list, get, update, ban, hints, points, referrals, purchases
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin, requirePermission } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';

const router = Router();
const User = () => mongoose.models.User;
const PurchaseHistory = () => mongoose.models.PurchaseHistory;

router.get('/', requireAdmin, requirePermission('users:read'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const skip = (page - 1) * limit;
    const q = (req.query.q || '').trim();
    const sort = (req.query.sort || 'lastLogin').toString();
    const bannedFilter = req.query.banned;
    const filter = {};
    if (q) {
      filter.$or = [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ];
    }
    if (bannedFilter === 'true' || bannedFilter === '1') filter.banned = true;
    else if (bannedFilter === 'false' || bannedFilter === '0') filter.banned = { $ne: true };

    const sortOpt = {};
    if (sort === 'points') sortOpt.points = -1;
    else if (sort === 'hints') sortOpt.hints = -1;
    else sortOpt.lastLogin = -1;
    if (sort === 'totalCleared') {
      const maxTotalCleared = 5000;
      const [users, total] = await Promise.all([
        User().find(filter).lean().limit(maxTotalCleared),
        User().countDocuments(filter),
      ]);
      const withTotal = users.map((u) => ({
        ...u,
        totalCleared: (u.levelPassedEasy || 0) + (u.levelPassedMedium || 0) + (u.levelPassedHard || 0),
      }));
      withTotal.sort((a, b) => (b.totalCleared || 0) - (a.totalCleared || 0));
      const paginated = withTotal.slice(skip, skip + limit);
      res.json({ success: true, users: paginated, total: Math.min(total, withTotal.length), page, limit });
      return;
    }

    const [users, total] = await Promise.all([
      User().find(filter).sort(sortOpt).skip(skip).limit(limit).lean(),
      User().countDocuments(filter),
    ]);
    res.json({ success: true, users, total, page, limit });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list users.' });
  }
});

router.get('/:username', requireAdmin, requirePermission('users:read'), async (req, res) => {
  try {
    const user = await User().findOne({ username: req.params.username }).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const { passwordHash, resetPasswordToken, resetPasswordExpires, ...safe } = user;
    res.json({ success: true, user: safe });
  } catch (err) {
    console.error('Admin user get error:', err);
    res.status(500).json({ success: false, message: 'Failed to get user.' });
  }
});

router.put('/:username', requireAdmin, requirePermission('users:write'), async (req, res) => {
  try {
    const user = await User().findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const { username, email, points, hints, premium, resetProgress, resetDailyCheckIn } = req.body || {};
    if (email !== undefined) user.email = email;
    if (points !== undefined) user.points = Math.max(0, Number(points));
    if (hints !== undefined) user.hints = Math.max(0, Number(hints));
    if (premium !== undefined) user.premium = Boolean(premium);
    if (resetProgress === true) {
      user.levelPassedEasy = 0;
      user.levelPassedMedium = 0;
      user.levelPassedHard = 0;
    }
    if (resetDailyCheckIn === true) {
      user.lastCheckInDate = null;
      user.checkInStreak = 0;
    }
    await user.save();
    await audit(req, 'user.update', `user:${user.username}`, { updates: req.body });
    res.json({ success: true, user: { username: user.username, points: user.points, hints: user.hints, premium: user.premium } });
  } catch (err) {
    console.error('Admin user update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
});

router.get('/:username/referrals', requireAdmin, requirePermission('users:read', 'referrals:read'), async (req, res) => {
  try {
    const referred = await User().find({ referredBy: { $regex: new RegExp(`^${req.params.username}`) } })
      .select('username email referredBy createdAt').lean();
    res.json({ success: true, referrals: referred });
  } catch (err) {
    console.error('Admin referrals list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list referrals.' });
  }
});

router.get('/:username/purchases', requireAdmin, requirePermission('users:read', 'shop:read'), async (req, res) => {
  try {
    const purchases = await PurchaseHistory().find({ username: req.params.username }).sort({ purchaseDate: -1 }).limit(100).lean();
    res.json({ success: true, purchases });
  } catch (err) {
    console.error('Admin purchases list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list purchases.' });
  }
});

router.post('/:username/ban', requireAdmin, requirePermission('users:ban'), async (req, res) => {
  try {
    const user = await User().findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : 'Banned by admin';
    user.banned = true;
    user.bannedAt = new Date();
    user.bannedBy = req.admin._id;
    user.banReason = reason;
    await user.save();
    await audit(req, 'user.ban', `user:${user.username}`, { reason });
    res.json({ success: true, user: { username: user.username, banned: true } });
  } catch (err) {
    console.error('Admin user ban error:', err);
    res.status(500).json({ success: false, message: 'Failed to ban user.' });
  }
});

router.delete('/:username/ban', requireAdmin, requirePermission('users:ban'), async (req, res) => {
  try {
    const user = await User().findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user.banned = false;
    user.bannedAt = undefined;
    user.bannedBy = undefined;
    user.banReason = undefined;
    await user.save();
    await audit(req, 'user.unban', `user:${user.username}`, {});
    res.json({ success: true, user: { username: user.username, banned: false } });
  } catch (err) {
    console.error('Admin user unban error:', err);
    res.status(500).json({ success: false, message: 'Failed to unban user.' });
  }
});

export default router;
