/**
 * GET /api/admin/maintenance — get maintenance mode
 * PUT /api/admin/maintenance — set maintenance mode (enabled, message)
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/rbac.js';
import { MaintenanceMode } from '../schemas.js';
import { audit } from '../middleware/audit.js';

const router = Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    let doc = await MaintenanceMode.findOne({ configKey: 'default' }).lean();
    if (!doc) {
      doc = { configKey: 'default', enabled: false, message: 'Under maintenance. Please try again later.' };
    }
    res.json({ success: true, maintenance: { enabled: !!doc.enabled, message: doc.message || 'Under maintenance. Please try again later.' } });
  } catch (err) {
    console.error('Maintenance get error:', err);
    res.status(500).json({ success: false, message: 'Failed to get maintenance mode.' });
  }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const { enabled, message } = req.body || {};
    const doc = await MaintenanceMode.findOneAndUpdate(
      { configKey: 'default' },
      {
        enabled: Boolean(enabled),
        message: message != null ? String(message) : 'Under maintenance. Please try again later.',
        updatedAt: new Date(),
        updatedBy: req.admin._id,
      },
      { upsert: true, new: true }
    );
    await audit(req, 'maintenance.update', 'maintenance', { enabled: doc.enabled, message: doc.message });
    res.json({ success: true, maintenance: { enabled: !!doc.enabled, message: doc.message } });
  } catch (err) {
    console.error('Maintenance update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update maintenance mode.' });
  }
});

export default router;
