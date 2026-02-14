/**
 * GET /api/admin/shop/transactions — list paid transactions (Money)
 * GET /api/admin/shop/transactions/export — CSV export by date range
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin } from '../middleware/rbac.js';

const router = Router();
const PurchaseHistory = () => mongoose.models.PurchaseHistory;

router.get('/transactions', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const username = (req.query.username || '').trim();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const filter = { purchaseMode: 'Money', amount: { $gt: 0 } };
    if (username) filter.username = { $regex: username, $options: 'i' };
    if (from || to) {
      filter.purchaseDate = {};
      if (from) filter.purchaseDate.$gte = from;
      if (to) filter.purchaseDate.$lte = to;
    }

    const [transactions, total] = await Promise.all([
      PurchaseHistory().find(filter).sort({ purchaseDate: -1 }).skip(skip).limit(limit).lean(),
      PurchaseHistory().countDocuments(filter),
    ]);
    res.json({ success: true, transactions, total, page, limit });
  } catch (err) {
    console.error('Shop transactions list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list transactions.' });
  }
});

router.get('/transactions/export', requireAdmin, async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const max = Math.min(10000, Math.max(1, parseInt(req.query.max, 10) || 5000));

    const filter = { purchaseMode: 'Money', amount: { $gt: 0 } };
    if (from || to) {
      filter.purchaseDate = {};
      if (from) filter.purchaseDate.$gte = from;
      if (to) filter.purchaseDate.$lte = to;
    }

    const transactions = await PurchaseHistory().find(filter).sort({ purchaseDate: -1 }).limit(max).lean();
    const header = 'Date,Username,Purchase ID,Amount,Pack,Type\n';
    const rows = transactions.map((t) =>
      `${t.purchaseDate ? new Date(t.purchaseDate).toISOString() : ''},${(t.username || '').replace(/,/g, ' ')},${(t.purchaseId || '').replace(/,/g, ' ')},${t.amount || 0},${(t.pack || '').replace(/,/g, ' ')},${(t.purchaseType || '').replace(/,/g, ' ')}`
    );
    const csv = header + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (err) {
    console.error('Transactions export error:', err);
    res.status(500).json({ success: false, message: 'Failed to export transactions.' });
  }
});

export default router;
