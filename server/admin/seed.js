import mongoose from 'mongoose';
import { GameConfig, MaintenanceMode } from './schemas.js';

/**
 * Seed default admin/config documents if they don't exist.
 * Called once when MongoDB connection opens.
 */
export async function seedFirstAdmin() {
  try {
    if (mongoose.connection.readyState !== 1) return;

    const [maintenanceExists, gameConfigExists] = await Promise.all([
      MaintenanceMode.exists({ configKey: 'default' }),
      GameConfig.exists({ configKey: 'default' }),
    ]);

    if (!maintenanceExists) {
      await MaintenanceMode.create({
        configKey: 'default',
        enabled: false,
        message: '',
      });
      console.log('✅ Default MaintenanceMode document created.');
    }

    if (!gameConfigExists) {
      await GameConfig.create({
        configKey: 'default',
        puppyCountEasy: 15,
        puppyCountMedium: 25,
        puppyCountHard: 40,
        timerMediumSeconds: 150,
        timerHardSeconds: 180,
        wrongTapLimit: 3,
        pointsPerLevelEasy: 5,
        pointsPerLevelMedium: 10,
        pointsPerLevelHard: 15,
        levelsEnabled: true,
        timerEnabled: true,
      });
      console.log('✅ Default GameConfig document created.');
    }
  } catch (err) {
    console.error('Admin seed error:', err);
    throw err;
  }
}
