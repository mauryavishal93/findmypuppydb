/**
 * Admin Panel — MongoDB schemas
 * Collections: adminUsers, adminAuditLogs, gameConfig, sceneAssets, hintConfig,
 * referralConfig, dailyCheckInConfig, leaderboardConfig, themeFlags, broadcastMessages, maintenanceMode
 */

import mongoose from 'mongoose';

const ROLES = ['super_admin', 'game_admin', 'content_admin', 'support_admin', 'finance_admin'];

const adminUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: '' },
  role: { type: String, required: true, enum: ROLES },
  permissions: [{ type: String }], // optional override e.g. ['users:read','users:write']
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  lastLoginIp: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'adminUsers' });

const adminAuditLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
  adminEmail: { type: String },
  action: { type: String, required: true },
  resource: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'adminAuditLogs' });

// Single-doc config; use findOne({}) or findOneAndUpdate
const gameConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  puppyCountEasy: { type: Number, default: 15 },
  puppyCountMedium: { type: Number, default: 25 },
  puppyCountHard: { type: Number, default: 40 },
  timerMediumSeconds: { type: Number, default: 150 },
  timerHardSeconds: { type: Number, default: 180 },
  wrongTapLimit: { type: Number, default: 3 },
  pointsPerLevelEasy: { type: Number, default: 5 },
  pointsPerLevelMedium: { type: Number, default: 10 },
  pointsPerLevelHard: { type: Number, default: 15 },
  levelsEnabled: { type: Boolean, default: true },
  difficultiesEnabled: { type: mongoose.Schema.Types.Mixed, default: { Easy: true, Medium: true, Hard: true } },
  timerEnabled: { type: Boolean, default: true },
  liveOverrides: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
}, { collection: 'gameConfig' });

const sceneAssetSchema = new mongoose.Schema({
  sceneId: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  imageUrl: { type: String, required: true },
  theme: { type: String, default: '' },
  difficulty: [{ type: String }],
  levelRange: { min: Number, max: Number },
  isEnabled: { type: Boolean, default: true },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'sceneAssets' });

const hintConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  freeHintsPerLevel: { type: Number, default: 2 },
  highlightDurationMs: { type: Number, default: 3000 },
  premiumPacks: [{ name: String, hintCount: Number, price: Number }],
  abuseThreshold: { type: Number, default: 50 },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'hintConfig' });

const referralConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  signupBonusHints: { type: Number, default: 25 },
  referrerRewardHints: { type: Number, default: 25 },
  enabled: { type: Boolean, default: true },
  maxReferralsPerUser: { type: Number, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'referralConfig' });

const dailyCheckInConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  rewardType: { type: String, enum: ['points', 'hints'], default: 'points' },
  rewardAmount: { type: Number, default: 5 },
  streakBonus: { type: Number, default: 2 },
  maxStreak: { type: Number, default: 7 },
  allowMissedReward: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'dailyCheckInConfig' });

const leaderboardConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  rankingType: { type: String, enum: ['score', 'progress'], default: 'score' },
  resetMode: { type: String, enum: ['none', 'monthly', 'seasonal'], default: 'none' },
  seasonEndDate: { type: Date },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'leaderboardConfig' });

const themeFlagsSchema = new mongoose.Schema({
  themeId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false },
  eventOnly: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'themeFlags' });

const broadcastMessageSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, default: '' },
  platform: { type: String, enum: ['web', 'android', 'all'], default: 'all' },
  activeAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'broadcastMessages' });

const maintenanceModeSchema = new mongoose.Schema({
  configKey: { type: String, default: 'default', unique: true },
  enabled: { type: Boolean, default: false },
  message: { type: String, default: 'Under maintenance. Please try again later.' },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
}, { collection: 'maintenanceMode' });

// Indexes for audit and lookups
adminAuditLogSchema.index({ adminId: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });

function getModel(name, schema) {
  if (mongoose.models[name]) return mongoose.model(name);
  return mongoose.model(name, schema);
}

export const AdminUser = getModel('AdminUser', adminUserSchema);
export const AdminAuditLog = getModel('AdminAuditLog', adminAuditLogSchema);
export const GameConfig = getModel('GameConfig', gameConfigSchema);
export const SceneAsset = getModel('SceneAsset', sceneAssetSchema);
export const HintConfig = getModel('HintConfig', hintConfigSchema);
export const ReferralConfig = getModel('ReferralConfig', referralConfigSchema);
export const DailyCheckInConfig = getModel('DailyCheckInConfig', dailyCheckInConfigSchema);
export const LeaderboardConfig = getModel('LeaderboardConfig', leaderboardConfigSchema);
export const ThemeFlags = getModel('ThemeFlags', themeFlagsSchema);
export const BroadcastMessage = getModel('BroadcastMessage', broadcastMessageSchema);
export const MaintenanceMode = getModel('MaintenanceMode', maintenanceModeSchema);

export { ROLES };
