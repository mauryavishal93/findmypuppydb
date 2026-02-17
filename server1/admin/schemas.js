import mongoose from 'mongoose';

const maintenanceModeSchema = new mongoose.Schema(
  {
    configKey: { type: String, required: true, unique: true, default: 'default' },
    enabled: { type: Boolean, default: false },
    message: { type: String, default: '' },
  },
  { collection: 'maintenanceMode', timestamps: true }
);

const gameConfigSchema = new mongoose.Schema(
  {
    configKey: { type: String, required: true, unique: true, default: 'default' },
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
    timerEnabled: { type: Boolean, default: true },
  },
  { collection: 'gameConfig', timestamps: true }
);

export const MaintenanceMode =
  mongoose.models.MaintenanceMode || mongoose.model('MaintenanceMode', maintenanceModeSchema);
export const GameConfig =
  mongoose.models.GameConfig || mongoose.model('GameConfig', gameConfigSchema);
