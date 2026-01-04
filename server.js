
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcrypt';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Professional SRE Rule: Always allow the environment to override the PORT
const PORT = process.env.PORT || 57174;

// Razorpay Configuration (Use Environment Variables for Production)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_RyzZQD56IABhEH';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'Ny5tgTW7aCJMhAizWWGvOSDZ';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

console.log(`💳 Razorpay Initialized with Key ID: ${RAZORPAY_KEY_ID.substring(0, 8)}...`);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the 'dist' directory in production
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const distPath = join(__dirname, 'dist');

console.log('--- Deployment Diagnostics ---');
console.log(`Node version: ${process.version}`);
console.log(`Current Dir: ${__dirname}`);
console.log(`Target Dist Path: ${distPath}`);
console.log(`Environment: ${process.env.NODE_ENV}`);

if (isProduction) {
  if (fs.existsSync(distPath)) {
    console.log('✅ Dist folder found. Serving static files.');
    app.use(express.static(distPath));
  } else {
    console.error('❌ CRITICAL ERROR: Dist folder NOT found! Run "npm run build" before starting the server.');
  }
} else {
  console.log('🚀 Running in DEVELOPMENT mode.');
}

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://vimaurya24_db_user:jrPF6GqaTX9H40s1@findmypuppy.q6hlrak.mongodb.net/findmypuppy?appName=findmypuppy";
const COLLECTION_NAME = "user"; 

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Schema Definition
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  hints: { type: Number, default: 0 }, // Total hints bought with money or points
  points: { type: Number, default: 0 }, // Points earned/used (separate from score)
  premium: { type: Boolean, default: false }, // Premium subscription status
  levelPassedEasy: { type: Number, default: 0 }, // Number of levels passed in Easy difficulty
  levelPassedMedium: { type: Number, default: 0 }, // Number of levels passed in Medium difficulty
  levelPassedHard: { type: Number, default: 0 }, // Number of levels passed in Hard difficulty
  referredBy: { type: String, default: "" }, // Referral code used during signup (empty string instead of null)
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
}, { collection: COLLECTION_NAME });

// Ensure strict is false for this model just in case
userSchema.set('strict', false);

// Clear model cache to ensure latest schema is used
if (mongoose.models['User']) {
  delete mongoose.models['User'];
}
const User = mongoose.model('User', userSchema);

// Purchase History Schema
const purchaseHistorySchema = new mongoose.Schema({
  username: { type: String, required: true },
  purchaseDate: { type: Date, default: Date.now },
  purchaseId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  purchaseType: { type: String, required: true, enum: ['Premium', 'Hints'] },
  pack: { type: String, required: true }, // Hint count or Premium type
  // How the purchase was made: 'Money' (₹) or 'Points' (Pts)
  purchaseMode: { type: String, enum: ['Money', 'Points','Referral'], default: 'Money' }
}, { collection: 'purchaseHistory' });

const PurchaseHistory = mongoose.model('PurchaseHistory', purchaseHistorySchema);

// Price Offer Schema
const priceOfferSchema = new mongoose.Schema({
  hintPack: { type: String, required: true, unique: true }, // e.g., "100 Hints Pack"
  marketPrice: { type: Number, required: true }, // Original price
  offerPrice: { type: Number, required: true }, // Current offer price
  hintCount: { type: Number, required: true }, // Number of hints in this pack
  offerReason: { type: String, default: 'Special Offer' } // Reason for the offer (e.g., "Special Offer", "Limited Time Deal", etc.)
}, { collection: 'priceOffer' });

const PriceOffer = mongoose.model('PriceOffer', priceOfferSchema);

// Initialize default price offer on server start
const initializePriceOffer = async () => {
  try {
    const existingOffer = await PriceOffer.findOne({ hintPack: '100 Hints Pack' });
    if (!existingOffer) {
        const defaultOffer = new PriceOffer({
          hintPack: '100 Hints Pack',
          marketPrice: 99,
          offerPrice: 9,
          hintCount: 100,
          offerReason: 'Special Offer'
        });
      await defaultOffer.save();
      console.log('✅ Default price offer initialized in database');
    } else {
      // Update existing offer to add offerReason field if it doesn't exist
      if (!existingOffer.offerReason) {
        existingOffer.offerReason = 'Special Offer';
        await existingOffer.save();
        console.log('✅ Updated existing price offer with offerReason field');
      } else {
        console.log('ℹ️ Price offer already exists in database with offerReason');
      }
    }
  } catch (error) {
    console.error('⚠️ Error initializing price offer:', error);
  }
};

// Run initialization after mongoose connection is established
mongoose.connection.once('open', async () => {
  initializePriceOffer();
  
  // Migration: Ensure all existing users have the 'referredBy' field
  try {
    // 1. Add referredBy only where it is missing, null, or empty
    const result = await User.updateMany(
      {
        $or: [
          { referredBy: { $exists: false } },
          { referredBy: null },
          { referredBy: "" }
        ]
      },
      {
        $set: { referredBy: "" }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `✅ Database Migration: Updated 'referredBy' for ${result.modifiedCount} users`
      );
    } else {
      console.log("ℹ️ No records needed migration");
    }
  } catch (error) {
    console.error("⚠️ Migration Error:", error);
  }  
});

// --- ROUTES ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user by username
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found. Please sign up." });
    }

    // Compare password with hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Login successful!", 
      user: { 
        username: user.username, 
        email: user.email,
        hints: user.hints || 0,
        points: user.points || 0,
        premium: user.premium || false,
        levelPassedEasy: user.levelPassedEasy || 0,
        levelPassedMedium: user.levelPassedMedium || 0,
        levelPassedHard: user.levelPassedHard || 0,
        referredBy: user.referredBy || ""
      } 
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: "Server error during login." });
  }
});

// Signup Endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password, referralCode } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Username, email, and password are required." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Username or Email already exists." });
    }

    // Handle Referral Logic
    let referrerUser = null;
    let finalReferredByCode = null;

    console.log(`\n🔍 Signup Referral Check:`);
    console.log(`- Received referralCode: "${referralCode}"`);

    if (referralCode && referralCode.trim() !== "") {
      const codeToUse = referralCode.trim();
      
      // Referral code format is {username}{year}. We skip the last 4 digits (year) to find the referrer.
      if (codeToUse.length > 4) {
        const extractedUsername = codeToUse.slice(0, -4);
        console.log(`- Extracted Referrer Username: "${extractedUsername}"`);
        console.log(`- Current Year suffix: "${codeToUse.slice(-4)}"`);
        
        // Case-insensitive search for referrer to be robust
        referrerUser = await User.findOne({ 
          username: { $regex: new RegExp(`^${extractedUsername}$`, 'i') } 
        });
        
        if (referrerUser) {
          finalReferredByCode = codeToUse; // Store the exact code used during signup
          console.log(`✅ Referrer found: "${referrerUser.username}". Validated referral code: "${finalReferredByCode}"`);
        } else {
          console.log(`❌ Invalid Referral Code: User "${extractedUsername}" not found in database.`);
          return res.status(400).json({ success: false, message: "Invalid referral code. No such user exists." });
        }
      } else {
        // Code is too short to be valid {username}{year}
        console.log(`❌ Invalid Referral Code: "${codeToUse}" is too short (min 5 chars).`);
        return res.status(400).json({ success: false, message: "Invalid referral code format." });
      }
    } else {
      console.log(`ℹ️ No referral code provided or empty string.`);
    }

    // Hash password before saving
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Initial hints for new user (0 normally, 25 if referred)
    const initialHints = referrerUser ? 25 : 0;

    // Create new user object
    const userToSave = {
      username,
      email,
      password: hashedPassword,
      hints: initialHints,
      points: 0,
      premium: false,
      levelPassedEasy: 0,
      levelPassedMedium: 0,
      levelPassedHard: 0,
      referredBy: finalReferredByCode ? String(finalReferredByCode) : ""
    };

    const newUser = new User(userToSave);

    console.log(`\n💾 DATA VALIDATION BEFORE DB WRITE:`);
    console.log(`- Username: ${newUser.username}`);
    console.log(`- referredBy: "${newUser.referredBy}" (Type: ${typeof newUser.referredBy})`);

    // Force set the field to ensure it's not ignored
    newUser.set('referredBy', finalReferredByCode ? String(finalReferredByCode) : "");

    const savedUser = await newUser.save();
    
    // Double-verify the write by fetching it back from DB
    const verifiedUser = await User.findById(savedUser._id);
    console.log(`✅ DB WRITE VERIFIED! Document in DB now contains:`);
    console.log(`- Username: ${verifiedUser.username}`);
    console.log(`- referredBy: "${verifiedUser.referredBy}"`);

    // Reward the referrer if applicable (+25 Hints)
    if (referrerUser) {
      console.log(`🎁 Awarding reward to referrer: ${referrerUser.username}`);
      referrerUser.hints = (referrerUser.hints || 0) + 25;
      await referrerUser.save();
      
      // Add purchase history entry for reward
      const rewardPurchaseId = `REWARD_${Date.now()}_${referrerUser.username}`;
      const rewardEntry = new PurchaseHistory({
        username: referrerUser.username,
        purchaseId: rewardPurchaseId,
        amount: 0,
        purchaseType: 'Hints',
        pack: 'Referral Reward (25 Hints)',
        purchaseMode: 'Referral'
      });
      await rewardEntry.save();
      console.log(`✅ Referrer reward saved: ${referrerUser.username}`);
    }

    // Prepare response user object - BE EXPLICIT
    const finalResponseUser = {
      username: verifiedUser.username,
      email: verifiedUser.email,
      hints: verifiedUser.hints,
      referredBy: verifiedUser.referredBy, // This MUST be here
      points: verifiedUser.points,
      premium: verifiedUser.premium,
      levelPassedEasy: verifiedUser.levelPassedEasy,
      levelPassedMedium: verifiedUser.levelPassedMedium,
      levelPassedHard: verifiedUser.levelPassedHard
    };

    console.log(`📤 SENDING SIGNUP RESPONSE:`, { 
      success: true, 
      user: { 
        username: finalResponseUser.username, 
        referredBy: finalResponseUser.referredBy 
      } 
    });

    res.status(201).json({ 
      success: true, 
      message: finalReferredByCode 
        ? `Account created! You received 25 bonus hints for being referred.`
        : "Account created successfully!", 
      user: finalResponseUser
    });
  } catch (error) {
    console.error('Signup Error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Username or Email already exists." });
    }
    res.status(500).json({ success: false, message: "Server error during signup." });
  }
});

// Update User Hints Endpoint
app.post('/api/user/update-hints', async (req, res) => {
  try {
    const { username, hints, currentUser } = req.body;

    if (!username || hints === undefined) {
      return res.status(400).json({ success: false, message: "Username and hints are required." });
    }

    // // Authorization check: Users can only update their own hints
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only update your own hints." 
    //   });
    // }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.hints = hints;
    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Hints updated successfully!", 
      hints: user.hints 
    });
  } catch (error) {
    console.error('Update Hints Error:', error);
    res.status(500).json({ success: false, message: "Server error updating hints." });
  }
});

// Update User Points Endpoint
app.post('/api/user/update-points', async (req, res) => {
  try {
    const { username, points, currentUser } = req.body;

    if (!username || points === undefined) {
      return res.status(400).json({ success: false, message: "Username and points are required." });
    }

    // // Authorization check: Users can only update their own points
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only update your own points." 
    //   });
    // }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.points = points;
    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Points updated successfully!", 
      points: user.points 
    });
  } catch (error) {
    console.error('Update Points Error:', error);
    res.status(500).json({ success: false, message: "Server error updating points." });
  }
});

// Update User Premium Status Endpoint
app.post('/api/user/update-premium', async (req, res) => {
  try {
    const { username, premium, currentUser } = req.body;

    if (!username || premium === undefined) {
      return res.status(400).json({ success: false, message: "Username and premium status are required." });
    }

    // // Authorization check: Users can only update their own premium status
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only update your own premium status." 
    //   });
    // }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.premium = premium;
    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Premium status updated successfully!", 
      premium: user.premium 
    });
  } catch (error) {
    console.error('Update Premium Error:', error);
    res.status(500).json({ success: false, message: "Server error updating premium status." });
  }
});

// Update User Level Passed Endpoint
app.post('/api/user/update-level-passed', async (req, res) => {
  try {
    const { username, difficulty, levelPassed, currentUser } = req.body;

    if (!username || !difficulty || levelPassed === undefined) {
      return res.status(400).json({ success: false, message: "Username, difficulty, and levelPassed are required." });
    }

    // // Authorization check: Users can only update their own level progress
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only update your own level progress." 
    //   });
    // }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Update the appropriate difficulty field
    if (difficulty === 'Easy') {
      user.levelPassedEasy = levelPassed;
    } else if (difficulty === 'Medium') {
      user.levelPassedMedium = levelPassed;
    } else if (difficulty === 'Hard') {
      user.levelPassedHard = levelPassed;
    } else {
      return res.status(400).json({ success: false, message: "Invalid difficulty. Must be 'Easy', 'Medium', or 'Hard'." });
    }

    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Level passed count updated successfully!", 
      levelPassedEasy: user.levelPassedEasy,
      levelPassedMedium: user.levelPassedMedium,
      levelPassedHard: user.levelPassedHard
    });
  } catch (error) {
    console.error('Update Level Passed Error:', error);
    res.status(500).json({ success: false, message: "Server error updating level passed count." });
  }
});

// --- RAZORPAY ENDPOINTS ---

// Create Razorpay Order
app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: "Amount is required." });
    }

    const options = {
      amount: Math.round(amount * 100), // Amount in smallest currency unit (paise)
      currency,
      receipt,
    };

    const order = await razorpay.orders.create(options);
    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error('Razorpay Order Error:', error);
    res.status(500).json({ success: false, message: "Failed to create Razorpay order." });
  }
});

// Verify Razorpay Payment
app.post('/api/razorpay/verify-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      username,
      pack,
      hintsToAdd
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isSignatureValid = expectedSignature === razorpay_signature;

    if (isSignatureValid) {
      // Payment is successful, update user hints and record purchase
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Update hints
      user.hints = (user.hints || 0) + hintsToAdd;
      await user.save();

      // Record purchase history
      const purchase = new PurchaseHistory({
        username,
        purchaseId: razorpay_payment_id,
        amount: req.body.amount || 0,
        purchaseType: 'Hints',
        pack,
        purchaseMode: 'Money'
      });
      await purchase.save();

      res.status(200).json({ 
        success: true, 
        message: "Payment verified and hints added.",
        hints: user.hints
      });
    } else {
      res.status(400).json({ success: false, message: "Invalid payment signature." });
    }
  } catch (error) {
    console.error('Razorpay Verification Error:', error);
    res.status(500).json({ success: false, message: "Failed to verify payment." });
  }
});

// Create Purchase History Endpoint (Manual/Legacy)
app.post('/api/purchase-history', async (req, res) => {
  try {
    const { username, amount, purchaseType, pack, purchaseMode, currentUser } = req.body;

    if (!username || !amount || !purchaseType || !pack) {
      return res.status(400).json({ success: false, message: "Username, amount, purchaseType, and pack are required." });
    }

    // // Authorization check: Users can only create purchase history for themselves
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only create purchase history for your own account." 
    //   });
    // }

    if (purchaseType !== 'Premium' && purchaseType !== 'Hints') {
      return res.status(400).json({ success: false, message: "purchaseType must be 'Premium' or 'Hints'." });
    }

    // Default purchaseMode to 'Money' if not provided (for backward compatibility)
    const safePurchaseMode = purchaseMode === 'Points' ? 'Points' : 'Money';

    // --- De-duplication guard ---
    // If there is already a purchase with the same user, pack, type and mode
    // in the last few seconds, treat it as the same purchase and don't insert another row.
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - 10_000);

    const existingRecentPurchase = await PurchaseHistory.findOne({
      username,
      purchaseType,
      pack,
      purchaseMode: safePurchaseMode,
      purchaseDate: { $gte: tenSecondsAgo }
    }).exec();

    if (existingRecentPurchase) {
      return res.status(200).json({
        success: true,
        message: "Duplicate purchase request ignored; existing recent purchase returned.",
        purchase: {
          purchaseId: existingRecentPurchase.purchaseId,
          purchaseDate: existingRecentPurchase.purchaseDate,
          amount: existingRecentPurchase.amount,
          purchaseType: existingRecentPurchase.purchaseType,
          pack: existingRecentPurchase.pack,
          purchaseMode: existingRecentPurchase.purchaseMode || 'Money'
        }
      });
    }

    // Generate unique purchase ID for a new record
    const purchaseId = `PURCHASE_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const purchase = await PurchaseHistory.findOneAndUpdate(
      {
        username,
        purchaseType,
        pack,
        purchaseMode: safePurchaseMode,
        purchaseDate: { $gte: tenSecondsAgo }
      },
      {
        $setOnInsert: {
      username,
      purchaseId,
      amount,
      purchaseType,
      pack,
          purchaseMode: safePurchaseMode,
      purchaseDate: new Date()
        }
      },
      {
        new: true,
        upsert: true
      }
    );

    await purchase.save();

    res.status(201).json({ 
      success: true, 
      message: "Purchase history created successfully!", 
      purchase: {
        purchaseId: purchase.purchaseId,
        purchaseDate: purchase.purchaseDate,
        amount: purchase.amount,
        purchaseType: purchase.purchaseType,
        pack: purchase.pack,
        purchaseMode: purchase.purchaseMode
      }
    });
  } catch (error) {
    console.error('Create Purchase History Error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Purchase ID already exists." });
    }
    res.status(500).json({ success: false, message: "Server error creating purchase history." });
  }
});

// Get Purchase History Endpoint
app.get('/api/purchase-history/:username', async (req, res) => {
  try {
    const { username } = req.params;
    // Get current user from query parameter or header (for authorization)
    const currentUser = req.query.currentUser || req.headers['x-current-user'];

    // // Authorization check: Users can only access their own purchase history
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only view your own purchase history." 
    //   });
    // }

    // Only fetch purchases where mode is Money or Referral (exclude Points)
    const purchases = await PurchaseHistory.find({ 
      username,
      purchaseMode: { $in: ['Money', 'Referral'] }
    })
      .sort({ purchaseDate: -1 }) // Most recent first
      .exec();

    res.status(200).json({ 
      success: true, 
      purchases: purchases.map(p => ({
        purchaseId: p.purchaseId,
        purchaseDate: p.purchaseDate,
        amount: p.amount,
        purchaseType: p.purchaseType,
        pack: p.pack,
        purchaseMode: p.purchaseMode || 'Money'
      }))
    });
  } catch (error) {
    console.error('Get Purchase History Error:', error);
    res.status(500).json({ success: false, message: "Server error fetching purchase history." });
  }
});

// Get User Data Endpoint
app.get('/api/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    // Get current user from query parameter or header (for authorization)
    // const currentUser = req.query.username || req.headers['x-current-user'];

    // // Authorization check: Users can only access their own data

    // console.log("currentUser", currentUser);
    // console.log("username", username);
    // if (!currentUser || currentUser !== username) {
    //   return res.status(403).json({ 
    //     success: false, 
    //     message: "Access denied. You can only view your own user data." 
    //   });
    // }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.status(200).json({ 
      success: true, 
      user: { 
        username: user.username, 
        email: user.email,
        hints: user.hints || 0,
        points: user.points || 0,
        premium: user.premium || false,
        levelPassedEasy: user.levelPassedEasy || 0,
        levelPassedMedium: user.levelPassedMedium || 0,
        levelPassedHard: user.levelPassedHard || 0,
        referredBy: user.referredBy || ""
      } 
    });
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({ success: false, message: "Server error fetching user data." });
  }
});

// Get Price Offer Endpoint
app.get('/api/price-offer', async (req, res) => {
  try {
    const offer = await PriceOffer.findOne({ hintPack: '100 Hints Pack' });
    
    if (!offer) {
      // Return default values if no offer exists in DB
      return res.status(200).json({
        success: true,
        offer: {
          hintPack: '100 Hints Pack',
          marketPrice: 99,
          offerPrice: 9,
          hintCount: 100,
          offerReason: 'Special Offer'
        }
      });
    }

    res.status(200).json({
      success: true,
      offer: {
        hintPack: offer.hintPack,
        marketPrice: offer.marketPrice,
        offerPrice: offer.offerPrice,
        hintCount: offer.hintCount,
        offerReason: offer.offerReason || 'Special Offer'
      }
    });
  } catch (error) {
    console.error('Get Price Offer Error:', error);
    res.status(500).json({ success: false, message: "Server error fetching price offer." });
  }
});

// Create/Update Price Offer Endpoint (Admin)
app.post('/api/price-offer', async (req, res) => {
  try {
    const { hintPack, marketPrice, offerPrice, hintCount, offerReason } = req.body;

    if (!hintPack || marketPrice === undefined || offerPrice === undefined || hintCount === undefined) {
      return res.status(400).json({ success: false, message: "hintPack, marketPrice, offerPrice, and hintCount are required." });
    }

    const updateData = { hintPack, marketPrice, offerPrice, hintCount };
    if (offerReason !== undefined) {
      updateData.offerReason = offerReason;
    }

    const offer = await PriceOffer.findOneAndUpdate(
      { hintPack },
      updateData,
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: "Price offer updated successfully!",
      offer: {
        hintPack: offer.hintPack,
        marketPrice: offer.marketPrice,
        offerPrice: offer.offerPrice,
        hintCount: offer.hintCount,
        offerReason: offer.offerReason || 'Special Offer'
      }
    });
  } catch (error) {
    console.error('Create/Update Price Offer Error:', error);
    res.status(500).json({ success: false, message: "Server error updating price offer." });
  }
});

// Migration endpoint to add offerReason to existing price offers
app.post('/api/price-offer/migrate', async (req, res) => {
  try {
    const offers = await PriceOffer.find({});
    let updatedCount = 0;
    
    for (const offer of offers) {
      if (!offer.offerReason) {
        offer.offerReason = 'Special Offer';
        await offer.save();
        updatedCount++;
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Migration completed. Updated ${updatedCount} price offer(s) with offerReason field.`,
      updatedCount
    });
  } catch (error) {
    console.error('Migration Error:', error);
    res.status(500).json({ success: false, message: "Server error during migration." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend Server running on http://localhost:${PORT} (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);
  
  if (isProduction) {
    // In production, for any request that doesn't match a static file or API route,
    // serve index.html to support client-side routing (SPA)
    app.get('*', (req, res) => {
      // 1. Never serve HTML for API calls
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
      
      // 2. Never serve HTML for missing static assets (fixes MIME error)
      if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|webmanifest)$/)) {
        return res.status(404).send('Asset not found');
      }

      // 3. Serve index.html for everything else (SPA routing)
      const indexPath = join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application not built. Please run "npm run build".');
      }
    });
  } else {
    // Start the frontend dev server ONLY in development
    console.log('📦 Starting frontend dev server...');
    const viteProcess = spawn('npm', ['run', 'dev'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });
  
  viteProcess.on('error', (error) => {
    console.error('❌ Failed to start frontend dev server:', error);
  });
  
  viteProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ Frontend dev server exited with code ${code}`);
    }
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down servers...');
    viteProcess.kill();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down servers...');
    viteProcess.kill();
    process.exit(0);
  });
  }
});
