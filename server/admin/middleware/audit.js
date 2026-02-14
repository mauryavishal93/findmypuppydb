/**
 * Audit log helper. Call after successful mutation.
 * audit(req, action, resource, details)
 */

import { AdminAuditLog } from '../schemas.js';

export function audit(req, action, resource, details = null) {
  if (!req.admin) return Promise.resolve();
  const log = new AdminAuditLog({
    adminId: req.admin._id,
    adminEmail: req.admin.email,
    action,
    resource: resource || undefined,
    details: details || undefined,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('user-agent'),
  });
  return log.save().catch((err) => console.error('Audit log save error:', err));
}
