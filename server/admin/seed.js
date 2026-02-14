/**
 * Seed first super admin if ADMIN_INIT_EMAIL and ADMIN_INIT_PASSWORD are set and no admin exists.
 * Change password after first login in production.
 */

import bcrypt from 'bcrypt';
import { AdminUser } from './schemas.js';

const SALT_ROUNDS = 12;

export async function seedFirstAdmin() {
  const email = process.env.ADMIN_INIT_EMAIL || process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INIT_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await AdminUser.findOne({ email: email.trim().toLowerCase() });
  if (existing) return;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await AdminUser.create({
    email: email.trim().toLowerCase(),
    passwordHash,
    name: 'Super Admin',
    role: 'super_admin',
    isActive: true,
  });
  console.log('🔐 Admin Panel: First super admin created. Change password after first login.');
}
