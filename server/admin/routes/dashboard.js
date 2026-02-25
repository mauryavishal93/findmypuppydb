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
    const startOfToday     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sevenDaysAgo     = new Date(startOfToday); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // ── Single-pass user aggregation ─────────────────────────────────────────
    // Counts totalUsers, DAU, MAU, last-month logins, and 7-day DAU breakdown
    // in one pipeline instead of 4 separate countDocuments calls.
    const [userAgg, purchaseAgg] = await Promise.all([

      UserModel.aggregate([
        {
          $facet: {
            total:     [{ $count: 'n' }],
            dau:       [{ $match: { lastLogin: { $gte: startOfToday } } },     { $count: 'n' }],
            mau:       [{ $match: { lastLogin: { $gte: startOfMonth } } },     { $count: 'n' }],
            lastMonth: [{ $match: { lastLogin: { $gte: startOfLastMonth, $lt: startOfMonth } } }, { $count: 'n' }],
            // 7-day sparkline DAU: bucket by day
            dauByDay: [
              { $match: { lastLogin: { $gte: sevenDaysAgo } } },
              { $group: {
                _id: {
                  y: { $year: '$lastLogin' },
                  m: { $month: '$lastLogin' },
                  d: { $dayOfMonth: '$lastLogin' },
                },
                count: { $sum: 1 },
              }},
            ],
          },
        },
      ]),

      // ── Single-pass purchase aggregation ─────────────────────────────────
      // All revenue buckets + hints stats in one pipeline pass.
      PurchaseHistoryModel.aggregate([
        {
          $facet: {
            revenueToday: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 }, purchaseDate: { $gte: startOfToday } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            revenueYesterday: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 }, purchaseDate: { $gte: startOfYesterday, $lt: startOfToday } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            revenueMonth: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 }, purchaseDate: { $gte: startOfMonth } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            revenueLastMonth: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 }, purchaseDate: { $gte: startOfLastMonth, $lt: startOfMonth } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            revenueTotal: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ],
            razorpayHints: [
              { $match: { purchaseType: 'Hints', purchaseMode: 'Money', purchaseId: { $regex: /^pay_/ } } },
              { $group: { _id: null, hints: { $sum: '$hintsCount' }, txns: { $sum: 1 } } },
            ],
            freeHints: [
              { $match: { purchaseType: 'Hints', purchaseMode: { $in: ['Points', 'Referral'] } } },
              { $group: { _id: null, hints: { $sum: '$hintsCount' }, txns: { $sum: 1 } } },
            ],
            // 7-day sparkline revenue: bucket by day
            revenueByDay: [
              { $match: { purchaseMode: 'Money', amount: { $gt: 0 }, purchaseDate: { $gte: sevenDaysAgo } } },
              { $group: {
                _id: {
                  y: { $year: '$purchaseDate' },
                  m: { $month: '$purchaseDate' },
                  d: { $dayOfMonth: '$purchaseDate' },
                },
                total: { $sum: '$amount' },
              }},
            ],
          },
        },
      ]),
    ]);

    // ── Unpack user aggregation ───────────────────────────────────────────────
    const ua = userAgg[0];
    const totalUsers  = ua.total[0]?.n     ?? 0;
    const DAU         = ua.dau[0]?.n       ?? 0;
    const MAU         = ua.mau[0]?.n       ?? 0;

    // Build a lookup map for DAU by day: "YYYY-M-D" → count
    const dauMap = {};
    for (const b of ua.dauByDay) {
      dauMap[`${b._id.y}-${b._id.m}-${b._id.d}`] = b.count;
    }

    // ── Unpack purchase aggregation ───────────────────────────────────────────
    const pa = purchaseAgg[0];
    const r = (facet) => Math.round(((facet[0]?.total) || 0) * 100) / 100;

    const revenueMap = {};
    for (const b of pa.revenueByDay) {
      revenueMap[`${b._id.y}-${b._id.m}-${b._id.d}`] = Math.round((b.total || 0) * 100) / 100;
    }

    // ── Build 7-day sparkline ─────────────────────────────────────────────────
    const sparkline = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - i);
      const key  = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const date = d.toISOString().slice(0, 10);
      sparkline.push({ date, dau: dauMap[key] ?? 0, revenue: revenueMap[key] ?? 0 });
    }

    res.json({
      success: true,
      stats: {
        dau: DAU,
        mau: MAU,
        totalUsers,
        revenueToday:     r(pa.revenueToday),
        revenueYesterday: r(pa.revenueYesterday),
        revenueMonth:     r(pa.revenueMonth),
        revenueLastMonth: r(pa.revenueLastMonth),
        revenueTotal:     r(pa.revenueTotal),
        hintsSoldMoney:     pa.razorpayHints[0]?.hints ?? 0,
        hintsSoldMoneyTxns: pa.razorpayHints[0]?.txns  ?? 0,
        hintsSoldFree:      pa.freeHints[0]?.hints     ?? 0,
        hintsSoldFreeTxns:  pa.freeHints[0]?.txns      ?? 0,
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

// Shared projection for DAU/MAU user lists — only fields the table renders
const ACTIVE_USER_PROJECTION = {
  username: 1, email: 1, lastLogin: 1, authProvider: 1,
  points: 1, hints: 1,
  levelPassedEasy: 1, levelPassedMedium: 1, levelPassedHard: 1,
};

// Get DAU users list (logged in today)
router.get('/dau-users', requireAdmin, requirePermission('analytics:read', 'users:read'), async (req, res) => {
  try {
    const UserModel = mongoose.models.User;
    if (!UserModel) return res.status(500).json({ success: false, message: 'Models not available.' });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const users = await UserModel
      .find({ lastLogin: { $gte: startOfToday } }, ACTIVE_USER_PROJECTION)
      .sort({ lastLogin: -1 })
      .lean();

    res.json({ success: true, users, count: users.length });
  } catch (err) {
    console.error('DAU users error:', err);
    res.status(500).json({ success: false, message: 'Failed to load DAU users.' });
  }
});

// Get MAU users list (logged in this calendar month)
router.get('/mau-users', requireAdmin, requirePermission('analytics:read', 'users:read'), async (req, res) => {
  try {
    const UserModel = mongoose.models.User;
    if (!UserModel) return res.status(500).json({ success: false, message: 'Models not available.' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const users = await UserModel
      .find({ lastLogin: { $gte: startOfMonth } }, ACTIVE_USER_PROJECTION)
      .sort({ lastLogin: -1 })
      .lean();

    res.json({ success: true, users, count: users.length });
  } catch (err) {
    console.error('MAU users error:', err);
    res.status(500).json({ success: false, message: 'Failed to load MAU users.' });
  }
});

export default router;
