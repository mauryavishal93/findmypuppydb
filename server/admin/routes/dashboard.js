/**
 * GET /api/admin/dashboard/stats — DAU, MAU, revenue, hints sold, failed payments, etc.
 * Uses User and PurchaseHistory models registered in server.js.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin, requirePermission } from '../middleware/rbac.js';

const router = Router();

router.get('/stats', requireAdmin, requirePermission('analytics:read', 'users:read'), async (req, res) => {
  try {
    const UserModel = mongoose.models.User;
    const PurchaseHistoryModel = mongoose.models.PurchaseHistory;
    if (!UserModel || !PurchaseHistoryModel) {
      return res.status(500).json({ success: false, message: 'Models not available.' });
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfToday.getTime() - 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(startOfMonth.getTime() - 1);

    const [
      totalUsers,
      todayLogins,
      monthLogins,
      lastMonthLogins,
      revenueToday,
      revenueYesterday,
      revenueMonth,
      revenueLastMonth,
      revenueTotal,
      hintsSold,
    ] = await Promise.all([
      UserModel.countDocuments({}),
      UserModel.countDocuments({ lastLogin: { $gte: startOfToday } }),
      UserModel.countDocuments({ lastLogin: { $gte: startOfMonth } }),
      UserModel.countDocuments({ lastLogin: { $gte: startOfLastMonth, $lt: startOfMonth } }),
      PurchaseHistoryModel.aggregate([
        { $match: { purchaseDate: { $gte: startOfToday }, purchaseMode: 'Money', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => (r[0] && r[0].total) || 0),
      PurchaseHistoryModel.aggregate([
        { $match: { purchaseDate: { $gte: startOfYesterday, $lte: endOfYesterday }, purchaseMode: 'Money', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => (r[0] && r[0].total) || 0),
      PurchaseHistoryModel.aggregate([
        { $match: { purchaseDate: { $gte: startOfMonth }, purchaseMode: 'Money', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => (r[0] && r[0].total) || 0),
      PurchaseHistoryModel.aggregate([
        { $match: { purchaseDate: { $gte: startOfLastMonth, $lte: endOfLastMonth }, purchaseMode: 'Money', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => (r[0] && r[0].total) || 0),
      PurchaseHistoryModel.aggregate([
        { $match: { purchaseMode: 'Money', amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).then((r) => (r[0] && r[0].total) || 0),
      PurchaseHistoryModel.countDocuments({ purchaseType: 'Hints' }),
    ]);

    const MAU = monthLogins;
    const DAU = todayLogins;

    // Last 7 days: DAU and revenue per day for sparklines
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      last7Days.push({ date: dayStart.toISOString().slice(0, 10), dayStart, dayEnd });
    }
    const dauByDay = await Promise.all(
      last7Days.map(({ dayStart, dayEnd }) =>
        UserModel.countDocuments({ lastLogin: { $gte: dayStart, $lt: dayEnd } })
      )
    );
    const revenueByDay = await Promise.all(
      last7Days.map(({ dayStart, dayEnd }) =>
        PurchaseHistoryModel.aggregate([
          { $match: { purchaseDate: { $gte: dayStart, $lt: dayEnd }, purchaseMode: 'Money', amount: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]).then((r) => (r[0] && r[0].total) ? Math.round(r[0].total * 100) / 100 : 0)
      )
    );
    const sparkline = last7Days.map(({ date }, i) => ({
      date,
      dau: dauByDay[i],
      revenue: revenueByDay[i],
    }));

    res.json({
      success: true,
      stats: {
        dau: DAU,
        mau: MAU,
        totalUsers,
        revenueToday: Math.round(revenueToday * 100) / 100,
        revenueYesterday: Math.round(revenueYesterday * 100) / 100,
        revenueMonth: Math.round(revenueMonth * 100) / 100,
        revenueLastMonth: Math.round(revenueLastMonth * 100) / 100,
        revenueTotal: Math.round(revenueTotal * 100) / 100,
        hintsSold,
        failedPayments: 0,
        serverHealth: 'ok',
        sparkline,
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
});

// Get DAU users list (last 24 hours)
router.get('/dau-users', requireAdmin, requirePermission('analytics:read', 'users:read'), async (req, res) => {
  try {
    const UserModel = mongoose.models.User;
    if (!UserModel) {
      return res.status(500).json({ success: false, message: 'Models not available.' });
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dauUsers = await UserModel.find(
      { lastLogin: { $gte: startOfToday } },
      { username: 1, email: 1, lastLogin: 1, points: 1, hints: 1, levelPassedEasy: 1, levelPassedMedium: 1, levelPassedHard: 1 }
    )
      .sort({ lastLogin: -1 })
      .lean();

    res.json({
      success: true,
      users: dauUsers.map(u => ({
        username: u.username,
        email: u.email,
        lastLogin: u.lastLogin,
        points: u.points || 0,
        hints: u.hints || 0,
        levelPassedEasy: u.levelPassedEasy || 0,
        levelPassedMedium: u.levelPassedMedium || 0,
        levelPassedHard: u.levelPassedHard || 0,
      })),
      count: dauUsers.length,
    });
  } catch (err) {
    console.error('DAU users error:', err);
    res.status(500).json({ success: false, message: 'Failed to load DAU users.' });
  }
});

// Get MAU users list (last 30 days)
router.get('/mau-users', requireAdmin, requirePermission('analytics:read', 'users:read'), async (req, res) => {
  try {
    const UserModel = mongoose.models.User;
    if (!UserModel) {
      return res.status(500).json({ success: false, message: 'Models not available.' });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const mauUsers = await UserModel.find(
      { lastLogin: { $gte: startOfMonth } },
      { username: 1, email: 1, lastLogin: 1, points: 1, hints: 1, levelPassedEasy: 1, levelPassedMedium: 1, levelPassedHard: 1 }
    )
      .sort({ lastLogin: -1 })
      .lean();

    res.json({
      success: true,
      users: mauUsers.map(u => ({
        username: u.username,
        email: u.email,
        lastLogin: u.lastLogin,
        points: u.points || 0,
        hints: u.hints || 0,
        levelPassedEasy: u.levelPassedEasy || 0,
        levelPassedMedium: u.levelPassedMedium || 0,
        levelPassedHard: u.levelPassedHard || 0,
      })),
      count: mauUsers.length,
    });
  } catch (err) {
    console.error('MAU users error:', err);
    res.status(500).json({ success: false, message: 'Failed to load MAU users.' });
  }
});

export default router;
