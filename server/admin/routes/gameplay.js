/**
 * GET/PUT gameplay config: puppy count, timer, wrong tap limit, points, overrides, offerPrices
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAdmin, requirePermission } from '../middleware/rbac.js';
import { GameConfig } from '../schemas.js';
import { audit } from '../middleware/audit.js';

const router = Router();
const PriceOffer = () => mongoose.models.PriceOffer;

router.get('/config', requireAdmin, requirePermission('gameplay:read'), async (req, res) => {
  try {
    let config = await GameConfig.findOne({ configKey: 'default' });
    if (!config) {
      config = await GameConfig.create({ configKey: 'default' });
    }
    const offer = await PriceOffer().findOne({ hintPack: '100 Hints Pack' }).lean();
    const offerPrices = offer ? {
      hintPack: offer.hintPack,
      marketPrice: offer.marketPrice,
      offerPrice: offer.offerPrice,
      hintCount: offer.hintCount,
      offerReason: offer.offerReason || 'Special Offer',
    } : {
      hintPack: '100 Hints Pack',
      marketPrice: 99,
      offerPrice: 9,
      hintCount: 100,
      offerReason: 'Special Offer',
    };
    res.json({ success: true, config: config.toObject(), offerPrices });
  } catch (err) {
    console.error('Admin gameplay config get error:', err);
    res.status(500).json({ success: false, message: 'Failed to get config.' });
  }
});

router.put('/config', requireAdmin, requirePermission('gameplay:write'), async (req, res) => {
  try {
    const updates = req.body || {};
    const allowed = [
      'puppyCountEasy', 'puppyCountMedium', 'puppyCountHard',
      'timerMediumSeconds', 'timerHardSeconds', 'wrongTapLimit',
      'pointsPerLevelEasy', 'pointsPerLevelMedium', 'pointsPerLevelHard',
      'levelsEnabled', 'difficultiesEnabled', 'timerEnabled',
    ];
    const set = {};
    allowed.forEach((k) => { if (updates[k] !== undefined) set[k] = updates[k]; });
    set.updatedAt = new Date();
    set.updatedBy = req.admin._id;
    const config = await GameConfig.findOneAndUpdate(
      { configKey: 'default' },
      { $set: set },
      { new: true, upsert: true }
    );

    // Update price offer (OfferPrices) if provided
    const offerPrices = updates.offerPrices || updates.offerPrice;
    if (offerPrices && typeof offerPrices === 'object') {
      const { hintPack, marketPrice, offerPrice, hintCount, offerReason } = offerPrices;
      const pack = hintPack || '100 Hints Pack';
      const updateData = {};
      if (marketPrice !== undefined) updateData.marketPrice = Number(marketPrice);
      if (offerPrice !== undefined) updateData.offerPrice = Number(offerPrice);
      if (hintCount !== undefined) updateData.hintCount = Number(hintCount);
      if (offerReason !== undefined) updateData.offerReason = String(offerReason);
      if (Object.keys(updateData).length > 0) {
        await PriceOffer().findOneAndUpdate(
          { hintPack: pack },
          { $set: updateData },
          { upsert: true, new: true }
        );
      }
    }

    await audit(req, 'gameplay.config.update', 'gameConfig', { ...set, offerPrices: !!offerPrices });
    const offer = await PriceOffer().findOne({ hintPack: '100 Hints Pack' }).lean();
    const outOffer = offer ? {
      hintPack: offer.hintPack,
      marketPrice: offer.marketPrice,
      offerPrice: offer.offerPrice,
      hintCount: offer.hintCount,
      offerReason: offer.offerReason || 'Special Offer',
    } : { hintPack: '100 Hints Pack', marketPrice: 99, offerPrice: 9, hintCount: 100, offerReason: 'Special Offer' };
    res.json({ success: true, config: config.toObject(), offerPrices: outOffer });
  } catch (err) {
    console.error('Admin gameplay config update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update config.' });
  }
});

router.put('/overrides', requireAdmin, requirePermission('gameplay:write'), async (req, res) => {
  try {
    const liveOverrides = req.body?.liveOverrides ?? null;
    const config = await GameConfig.findOneAndUpdate(
      { configKey: 'default' },
      { $set: { liveOverrides, updatedAt: new Date(), updatedBy: req.admin._id } },
      { new: true, upsert: true }
    );
    await audit(req, 'gameplay.overrides.update', 'gameConfig', { liveOverrides });
    res.json({ success: true, liveOverrides: config.liveOverrides });
  } catch (err) {
    console.error('Admin gameplay overrides error:', err);
    res.status(500).json({ success: false, message: 'Failed to update overrides.' });
  }
});

export default router;
