/**
 * GET /api/admin/referrals        — paginated list of all referral events
 * GET /api/admin/referrals/stats  — top referrers + aggregate totals
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin, requirePermission } from '../middleware/rbac.js';

const router = Router();
const User            = () => mongoose.models.User;
const PurchaseHistory = () => mongoose.models.PurchaseHistory;

// ── Helper: extract referrer username from a referral code ─────────────────
// Code format: {username}{4-digit-year}  e.g. "alice2024"
const referrerFromCode = (code) => {
  if (!code || code.length < 5) return code || '';
  return code.slice(0, -4); // strip trailing 4-digit year
};

// ── GET /api/admin/referrals/stats ─────────────────────────────────────────
// Top referrers with count of referred users and total hints earned.
router.get('/stats', requireAdmin, requirePermission('users:read', 'referrals:read'), async (req, res) => {
  try {
    const UserModel            = User();
    const PurchaseHistoryModel = PurchaseHistory();
    if (!UserModel || !PurchaseHistoryModel) {
      return res.status(500).json({ success: false, message: 'Models not available.' });
    }

    // Total referred users (have a non-empty referredBy)
    const totalReferred = await UserModel.countDocuments({ referredBy: { $exists: true, $ne: '' } });

    // Total hints paid out to referrers via PurchaseHistory
    const hintsPaidAgg = await PurchaseHistoryModel.aggregate([
      { $match: { purchaseMode: 'Referral', purchaseType: 'Hints' } },
      { $group: { _id: null, totalHints: { $sum: '$hintsCount' }, totalEvents: { $sum: 1 } } },
    ]);
    const totalHintsPaid  = hintsPaidAgg[0]?.totalHints  ?? 0;
    const totalReferEvents = hintsPaidAgg[0]?.totalEvents ?? 0;

    // Top 20 referrers: join referred users with their reward records
    const topReferrers = await PurchaseHistoryModel.aggregate([
      { $match: { purchaseMode: 'Referral', purchaseType: 'Hints' } },
      { $group: {
        _id: '$username',                          // referrer username
        hintsEarned:   { $sum: '$hintsCount' },
        referralCount: { $sum: 1 },
        lastReferral:  { $max: '$purchaseDate' },
      }},
      { $sort: { referralCount: -1, hintsEarned: -1 } },
      { $limit: 20 },
      { $project: {
        _id: 0,
        referrer:      '$_id',
        hintsEarned:   1,
        referralCount: 1,
        lastReferral:  1,
      }},
    ]);

    res.json({
      success: true,
      stats: { totalReferred, totalHintsPaid, totalReferEvents },
      topReferrers,
    });
  } catch (err) {
    console.error('Admin referrals stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load referral stats.' });
  }
});

// ── GET /api/admin/referrals ───────────────────────────────────────────────
// Paginated list of referred users with who referred them, when, and hints earned.
router.get('/', requireAdmin, requirePermission('users:read', 'referrals:read'), async (req, res) => {
  try {
    const UserModel            = User();
    const PurchaseHistoryModel = PurchaseHistory();
    if (!UserModel || !PurchaseHistoryModel) {
      return res.status(500).json({ success: false, message: 'Models not available.' });
    }

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip  = (page - 1) * limit;
    const q     = (req.query.q || '').trim(); // search by referred or referrer username

    // Build filter: only users who were referred (referredBy is a non-empty, non-null string)
    const baseFilter = {
      referredBy: { $exists: true, $nin: [null, '', undefined] },
    };

    let filter;
    if (q) {
      // When searching, match the base condition AND (username OR referredBy contains q)
      filter = {
        ...baseFilter,
        $or: [
          { username:   { $regex: q, $options: 'i' } },
          { referredBy: { $regex: q, $options: 'i' } },
        ],
      };
    } else {
      filter = baseFilter;
    }

    const [referredUsers, total] = await Promise.all([
      UserModel.find(filter, {
        username: 1, email: 1, referredBy: 1, createdAt: 1, hints: 1,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    if (referredUsers.length === 0) {
      return res.json({ success: true, referrals: [], total, page, limit });
    }

    // Fetch the reward PurchaseHistory records for the referrers in this page
    // keyed by referrer username so we can join in JS
    const referrerUsernames = [...new Set(referredUsers.map(u => referrerFromCode(u.referredBy)))];
    const rewardRecords = await PurchaseHistoryModel.find(
      { username: { $in: referrerUsernames }, purchaseMode: 'Referral', purchaseType: 'Hints' },
      { username: 1, hintsCount: 1, purchaseDate: 1, purchaseId: 1 },
    ).sort({ purchaseDate: 1 }).lean();

    // Build a map: referrerUsername → sorted array of reward records (oldest first)
    // We'll consume each reward record once (closest in time to the referred user's signup)
    const rewardMap = {};
    for (const r of rewardRecords) {
      if (!rewardMap[r.username]) rewardMap[r.username] = [];
      rewardMap[r.username].push({ ...r, _used: false });
    }

    const referrals = referredUsers.map((u) => {
      const referrer  = referrerFromCode(u.referredBy);
      const rewards   = rewardMap[referrer] || [];
      // Find the closest unused reward record to when the referred user signed up
      const createdAt = new Date(u.createdAt).getTime();
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < rewards.length; i++) {
        if (rewards[i]._used) continue;
        const diff = Math.abs(new Date(rewards[i].purchaseDate).getTime() - createdAt);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      const matchedReward = bestIdx >= 0 ? rewards[bestIdx] : null;
      if (matchedReward) matchedReward._used = true;

      return {
        referredUser:        u.username,
        referredEmail:       u.email,
        referredAt:          u.createdAt,
        referralCode:        u.referredBy,
        referrer,
        referrerHintsEarned: matchedReward?.hintsCount ?? 0,
        rewardDate:          matchedReward?.purchaseDate ?? null,
      };
    });

    res.json({ success: true, referrals, total, page, limit });
  } catch (err) {
    console.error('Admin referrals list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load referrals.' });
  }
});

export default router;
