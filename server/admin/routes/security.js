/**
 * GET /api/admin/security/audit — list audit logs with optional filters
 * GET /api/admin/security/audit/export — CSV export
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { AdminAuditLog } from '../schemas.js';

const router = Router();

router.get('/audit', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;
    const adminEmail = (req.query.adminEmail || '').trim();
    const action = (req.query.action || '').trim();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const filter = {};
    if (adminEmail) filter.adminEmail = { $regex: adminEmail, $options: 'i' };
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AdminAuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, logs, total, page, limit });
  } catch (err) {
    console.error('Audit log list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load audit logs.' });
  }
});

router.get('/audit/export', requireAdmin, async (req, res) => {
  try {
    const adminEmail = (req.query.adminEmail || '').trim();
    const action = (req.query.action || '').trim();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const max = Math.min(5000, Math.max(1, parseInt(req.query.max, 10) || 1000));

    const filter = {};
    if (adminEmail) filter.adminEmail = { $regex: adminEmail, $options: 'i' };
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    const logs = await AdminAuditLog.find(filter).sort({ createdAt: -1 }).limit(max).lean();
    const header = 'Date,Admin Email,Action,Resource,Details,IP\n';
    const rows = logs.map((l) => {
      const details = (l.details && typeof l.details === 'object') ? JSON.stringify(l.details).replace(/"/g, '""') : (l.details || '');
      return `${l.createdAt ? new Date(l.createdAt).toISOString() : ''},${(l.adminEmail || '').replace(/,/g, ' ')},${(l.action || '').replace(/,/g, ' ')},${(l.resource || '').replace(/,/g, ' ')},${details},${(l.ip || '').replace(/,/g, ' ')}`;
    });
    const csv = header + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.send(csv);
  } catch (err) {
    console.error('Audit export error:', err);
    res.status(500).json({ success: false, message: 'Failed to export audit logs.' });
  }
});

export default router;
