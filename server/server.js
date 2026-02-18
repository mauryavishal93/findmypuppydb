
import dotenv from 'dotenv';
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
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import adminRouter from './admin/routes/index.js';
import { seedFirstAdmin } from './admin/seed.js';
import { GameConfig, MaintenanceMode } from './admin/schemas.js';

// Load environment variables (Render injects process.env; local can use .env files)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '.env') }); // server/.env
dotenv.config({ path: join(__dirname, '.env.local') }); // server/.env.local (local overrides)
dotenv.config(); // process.cwd() .env

const app = express();
// Professional SRE Rule: Always allow the environment to override the PORT
const PORT = process.env.PORT || 5774;

// Razorpay Configuration (Use Environment Variables for Production)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_RyzZQD56IABhEH';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'Ny5tgTW7aCJMhAizWWGvOSDZ';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

console.log(`💳 Razorpay Initialized with Key ID: ${RAZORPAY_KEY_ID.substring(0, 8)}...`);

// Google OAuth Configuration (use same client ID as frontend; Render may set VITE_GOOGLE_CLIENT_ID only)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (googleClient) {
  console.log(`🔐 Google OAuth Initialized with Client ID: ${GOOGLE_CLIENT_ID.substring(0, 20)}...`);
} else {
  console.warn('⚠️ Google OAuth not configured. Set GOOGLE_CLIENT_ID environment variable.');
}

// Testing: allow multiple daily run completions per day (set ALLOW_MULTIPLE_DAILY_RUNS=true)
const ALLOW_MULTIPLE_DAILY_RUNS = process.env.ALLOW_MULTIPLE_DAILY_RUNS === 'true';
if (ALLOW_MULTIPLE_DAILY_RUNS) {
  console.warn('⚠️ ALLOW_MULTIPLE_DAILY_RUNS is enabled — daily run can be completed multiple times per day (testing only).');
}

// Middleware
app.use(cors());
app.use(express.json());

// Allow Google Sign-In / OAuth popups to use postMessage (fixes "COOP would block window.postMessage" on Render)
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// Admin Panel API (RBAC-protected; separate auth from player auth)
app.use('/api/admin', adminRouter);

// Serve static files from the 'dist' directory in production
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const distPath = join(__dirname, '..', 'dist');

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

// MongoDB Connection (Render uses MONGODB_URI; support both)
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb+srv://vimaurya24_db_user:jrPF6GqaTX9H40s1@findmypuppy.q6hlrak.mongodb.net/findmypuppy?appName=findmypuppy";
const COLLECTION_NAME = "user"; 

mongoose.connect(MONGO_URI, {
  maxPoolSize: 10, // Maintain up to 10 socket connections
  serverSelectionTimeoutMS: 30000, // Keep trying to send operations for 30 seconds (default)
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
})
  .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    if (err.name === 'MongooseServerSelectionError') {
      console.error('   -> HINT: Check your IP Whitelist in MongoDB Atlas. Your current IP might be blocked.');
      console.error('   -> HINT: Ensure your firewall allows outbound traffic on port 27017.');
    }
  });

// Schema Definition
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true }, // Unique constraint automatically creates an index for fast lookups
  password: { type: String, required: false }, // Optional for OAuth users
  googleId: { type: String, unique: true, sparse: true }, // Google OAuth ID
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' }, // Track auth method
  hints: { type: Number, default: 0 }, // Total hints bought with money or points
  points: { type: Number, default: 0 }, // Points earned/used (separate from score)
  premium: { type: Boolean, default: false }, // Premium subscription status
  levelPassedEasy: { type: Number, default: 0 }, // Number of levels passed in Easy difficulty
  levelPassedMedium: { type: Number, default: 0 }, // Number of levels passed in Medium difficulty
  levelPassedHard: { type: Number, default: 0 }, // Number of levels passed in Hard difficulty
  referredBy: { type: String, default: "" }, // Referral code used during signup (empty string instead of null)
  resetPasswordToken: { type: String, default: null }, // Password reset token
  resetPasswordExpires: { type: Date, default: null }, // Token expiration date
  // Daily Check-In / Puppy Growth fields
  lastCheckInDate: { type: String, default: null }, // Last date daily check-in was completed (YYYY-MM-DD format)
  checkInStreak: { type: Number, default: 0 }, // Current consecutive days streak
  totalCheckIns: { type: Number, default: 0 }, // Total number of check-ins
  puppyAge: { type: Number, default: 0 }, // Puppy age in days (0-7, then cycles)
  puppySize: { type: Number, default: 1 }, // Puppy size multiplier (1.0 to 2.0 based on age)
  streakFreezeWeek: { type: String, default: null }, // ISO week "YYYY-Www" when user last used streak freeze
  lastDailyPuzzleDate: { type: String, default: null }, // YYYY-MM-DD - last day user completed daily puzzle
  puppyRunHighScore: { type: Number, default: 0 }, // Best score in Puppy Run game
  lastPlayedAt: { type: Date, default: null }, // Last time user played a level (for comeback bonus)
  comebackBonusClaimed: { type: Boolean, default: false }, // One-time bonus after 7+ days away
  achievements: { type: [String], default: [] }, // Array of achievement IDs unlocked
  weeklyChallengeWeek: { type: String, default: null }, // "YYYY-Www"
  weeklyChallengeProgress: { type: mongoose.Schema.Types.Mixed, default: { easy: 0, medium: 0, hard: 0 } },
  weeklyChallengeClaimed: { type: Boolean, default: false },
  unlockedThemes: { type: [String], default: ['sunny', 'night'] }, // Themes unlocked by user (default: first 2)
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  // Admin: ban
  banned: { type: Boolean, default: false },
  bannedAt: { type: Date },
  bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
  bannedReason: { type: String },
}, { collection: COLLECTION_NAME });

// Ensure strict is false for this model just in case
userSchema.set('strict', false);

// Optimize: Add index on username for faster lookups (email is already indexed by unique: true)
userSchema.index({ username: 1 });

// Note: Email field already has index via 'unique: true' and 'index: true' in schema definition
// No need for explicit userSchema.index() call to avoid duplicate index warning

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

// Optimize: Add compound index for fetching history by username
purchaseHistorySchema.index({ username: 1, purchaseDate: -1 });

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
  seedFirstAdmin().catch((err) => console.error('Admin seed error:', err));

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
  const dbStatus = mongoose.connection.readyState;
  const dbStatusText = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  }[dbStatus] || 'unknown';
  
  const emailConfigured = emailTransporter !== null;
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  
  res.json({ 
    status: dbStatus === 1 ? 'ok' : 'degraded',
    message: 'Server is running',
    database: {
      status: dbStatusText,
      readyState: dbStatus,
      connected: dbStatus === 1
    },
    email: {
      configured: emailConfigured,
      hasCredentials: !!smtpUser && !!smtpPass,
      transporterAvailable: emailConfigured
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      isRender: !!process.env.RENDER,
      port: process.env.PORT || 5774
    }
  });
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

    if (user.banned) {
      return res.status(403).json({ success: false, message: "This account has been banned." });
    }

    // Skip password check for OAuth users
    if (user.authProvider === 'google') {
      return res.status(401).json({ 
        success: false, 
        message: "This account uses Google sign-in. Please use 'Sign in with Google'." 
      });
    }

    // Validate password for local auth users
    if (!user.password) {
      return res.status(401).json({ success: false, message: "Invalid authentication method." });
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
        referredBy: user.referredBy || "",
        puppyRunHighScore: user.puppyRunHighScore || 0
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
      
      // Check referral achievement for referrer
      const referrerAchievements = referrerUser.achievements || [];
      const referredCount = await User.countDocuments({ referredBy: new RegExp(`^${referrerUser.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{4}$`) });
      if (referredCount >= 1 && !referrerAchievements.includes('referral_1')) {
        referrerUser.achievements = [...new Set([...referrerAchievements, 'referral_1'])];
        await referrerUser.save();
      }
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
      levelPassedHard: verifiedUser.levelPassedHard,
      puppyRunHighScore: verifiedUser.puppyRunHighScore || 0
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

// Normalize env value: trim, remove surrounding quotes, remove internal spaces (Gmail App Password is 16 chars)
function normalizeEnvValue(val) {
  if (val == null || typeof val !== 'string') return '';
  let s = val.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Gmail App Password is 16 chars; Google shows it as "xxxx xxxx xxxx xxxx" - strip spaces for SMTP
function normalizeAppPassword(val) {
  const s = normalizeEnvValue(val);
  return s.replace(/\s+/g, '');
}

// Email Configuration for Password Reset (moved up for better organization)
const createTransporter = () => {
  // Use environment variables for email configuration
  // For Gmail: Use App Password (not regular password) - see https://myaccount.google.com/apppasswords
  const smtpUser = normalizeEnvValue(process.env.SMTP_USER || process.env.EMAIL_USER || '');
  const smtpPass = normalizeAppPassword(process.env.SMTP_PASS || process.env.EMAIL_PASS || '');
  
  // Get SMTP settings
  // For production/Render: Try port 465 with SSL first (more reliable than 587)
  const isProduction = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
  const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  // Default to port 465 for production (more reliable on cloud platforms)
  const defaultPort = isProduction ? 465 : 587;
  const smtpPort = parseInt(process.env.SMTP_PORT || defaultPort.toString());
  // Default to secure=true for production (port 465 requires SSL)
  const defaultSecure = isProduction ? true : false;
  const smtpSecure = process.env.SMTP_SECURE !== undefined 
    ? process.env.SMTP_SECURE === 'true' 
    : defaultSecure;

  // Only create transporter if credentials are provided
  if (smtpUser && smtpPass) {
    // Gmail App Password configuration
    // For port 587: use secure: false, STARTTLS will be used automatically
    // For port 465: use secure: true for SSL
    const emailConfig = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // false for 587 (STARTTLS), true for 465 (SSL)
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      // Gmail App Passwords: Standard configuration (use Node default TLS, avoid deprecated SSLv3)
      tls: {
        rejectUnauthorized: false // Allow self-signed certs in development
      },
      // Connection timeout settings for Render/production environments
      // Longer timeouts for production to handle Gmail SMTP slowness on cloud platforms
      connectionTimeout: isProduction ? 120000 : 60000, // 120s (2 min) for production, 60s for dev
      socketTimeout: isProduction ? 120000 : 60000, // 120s (2 min) for production, 60s for dev
      greetingTimeout: isProduction ? 60000 : 30000, // 60s for production, 30s for dev
      // Connection pooling for better reliability
      pool: true,
      maxConnections: 1,
      maxMessages: 3,
      // Retry configuration - more retries for production
      retry: {
        attempts: isProduction ? 3 : 2,
        delay: isProduction ? 3000 : 2000
      },
      // Additional options for production
      ...(isProduction && {
        requireTLS: true, // Require TLS for security
        debug: false, // Set to true for detailed SMTP debugging
        logger: false // Disable default logger (we use our own)
      })
    };

    // Debug: Show configuration (mask password)
    const maskedPass = smtpPass.length > 4 
      ? smtpPass.substring(0, 2) + '****' + smtpPass.substring(smtpPass.length - 2)
      : '****';
    console.log('📧 Email Configuration:');
    console.log(`   Host: ${smtpHost}`);
    console.log(`   Port: ${smtpPort} ${isProduction ? '(Production default: 465)' : '(Development default: 587)'}`);
    console.log(`   Secure: ${smtpSecure} ${isProduction ? '(Production default: true for port 465)' : '(Development default: false for port 587)'}`);
    console.log(`   User: ${smtpUser}`);
    console.log(`   Pass: ${maskedPass}`);
    if (isProduction) {
      console.log(`   ⚠️  PRODUCTION MODE: Using optimized settings for cloud platforms`);
      if (smtpPort === 587 && !smtpSecure) {
        console.warn(`   ⚠️  WARNING: Port 587 may be blocked by Gmail on cloud platforms`);
        console.warn(`   💡 RECOMMENDATION: Set SMTP_PORT=465 and SMTP_SECURE=true in Render`);
        console.warn(`   💡 This is more reliable for production deployments`);
      }
    }

    const transporter = nodemailer.createTransport(emailConfig);
    
    // Skip verification in development or when requested (avoids 535 on startup; send is still attempted)
    const isDev = process.env.NODE_ENV !== 'production' && process.env.RENDER !== 'true';
    const skipVerification = process.env.SKIP_EMAIL_VERIFY === 'true' ||
                              isDev ||
                              (process.env.RENDER === 'true' && process.env.SKIP_EMAIL_VERIFY !== 'false');
    
    if (skipVerification) {
      console.log('📧 Email transporter created (verification skipped).');
      if (isDev) {
        console.log('   For password-reset emails: use Gmail App Password in .env — see PASSWORD_RESET_SETUP.md');
      }
    } else {
      // Verify transporter connection on startup (non-blocking with timeout)
      const verifyTimeout = setTimeout(() => {
        console.warn('⏱️  Email verification timeout; transporter ready for first send.');
      }, 10000);
      
      transporter.verify((error, success) => {
        clearTimeout(verifyTimeout);
        if (error) {
          console.warn('⚠️  Email verification failed (transporter still used for sends):', error.message?.split('\n')[0] || error.message);
          if (error.responseCode === 535) {
            console.warn('   Use Gmail App Password in .env — see PASSWORD_RESET_SETUP.md');
          }
        } else {
          console.log('✅ Email service verified and ready');
          console.log(`   SMTP Host: ${smtpHost}:${smtpPort}`);
          console.log(`   From Email: ${smtpUser}`);
        }
      });
    }
    
    return transporter;
  }
  return null;
};

const emailTransporter = createTransporter();

// Enhanced startup logging for Render debugging
console.log('\n📧 ========== EMAIL SERVICE INITIALIZATION ==========');
if (emailTransporter) {
  console.log('✅ Email transporter created successfully');
} else {
  console.error('❌ Email transporter NOT created');
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  console.error(`   SMTP_USER exists: ${!!smtpUser} (length: ${smtpUser.length})`);
  console.error(`   SMTP_PASS exists: ${!!smtpPass} (length: ${smtpPass.length})`);
  console.error('   Environment check:');
  console.error(`     NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.error(`     RENDER: ${process.env.RENDER || 'not set'}`);
  console.error('   ⚠️  Set SMTP_USER and SMTP_PASS environment variables in Render dashboard');
  console.error('   Example: SMTP_USER=your-email@gmail.com SMTP_PASS=your-app-password');
}
console.log('📧 ================================================\n');

// Log password-reset URL base when on Render (so deployers can verify reset links)
if (process.env.RENDER === 'true') {
  const frontendUrl = process.env.FRONTEND_URL || 'https://findmypuppy.onrender.com';
  console.log('🔗 [RENDER] Password reset links will use FRONTEND_URL:', frontendUrl);
  if (!process.env.FRONTEND_URL) {
    console.warn('   ⚠️  Set FRONTEND_URL in Render env if your app is not at https://findmypuppy.onrender.com');
  }
}

// Password Reset Request Endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Log request for debugging (especially in production)
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
      console.log(`\n[FORGOT-PASSWORD] ========== REQUEST RECEIVED ==========`);
      console.log(`[FORGOT-PASSWORD] Email: ${email || 'not provided'}`);
      console.log(`[FORGOT-PASSWORD] Email transporter available: ${emailTransporter !== null}`);
      console.log(`[FORGOT-PASSWORD] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[FORGOT-PASSWORD] Render: ${process.env.RENDER ? 'true' : 'false'}`);
    }

    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      console.error('[FORGOT-PASSWORD] Database not connected');
      console.error(`   Connection state: ${mongoose.connection.readyState}`);
      console.error('   0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting');
      return res.status(503).json({ 
        success: false, 
        message: "Database service is temporarily unavailable. Please try again later." 
      });
    }

    // Verify User model is available
    if (!User || typeof User.findOne !== 'function') {
      console.error('[FORGOT-PASSWORD] User model not available');
      return res.status(500).json({ 
        success: false, 
        message: "Server configuration error. Please contact support." 
      });
    }

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    // Normalize email (lowercase and trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Optimized database query: Use lean() for faster queries and select only needed fields
    // Index on email field ensures fast lookup (O(log n) instead of O(n))
    const queryStartTime = Date.now();
    let user;
    try {
      user = await User.findOne({ email: normalizedEmail })
        .select('email username authProvider password resetPasswordToken resetPasswordExpires')
        .lean() // Use lean() for faster queries (returns plain JS object instead of Mongoose document)
        .maxTimeMS(5000); // Set query timeout to 5 seconds for better performance monitoring
      
      const queryTime = Date.now() - queryStartTime;
      if (queryTime > 100) { // Log slow queries (>100ms)
        console.log(`[PERFORMANCE] Email lookup took ${queryTime}ms for: ${normalizedEmail}`);
      }
    } catch (dbError) {
      console.error('[FORGOT-PASSWORD] Database query error:');
      console.error(`   Error: ${dbError.message || dbError.toString()}`);
      console.error(`   Error Type: ${dbError.constructor.name}`);
      throw new Error(`Database query failed: ${dbError.message}`);
    }
    
    // Check if email exists in database
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "This email is not registered. Please check your email address or sign up for a new account." 
      });
    }

    // Check if user has local auth (not OAuth only)
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({ 
        success: false, 
        message: "This account uses Google sign-in. Please use 'Sign in with Google' to access your account." 
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1); // Token expires in 1 hour

    // Save token to user using findOneAndUpdate for efficiency (atomic operation)
    // This is faster than fetching, modifying, and saving
    try {
      const updateResult = await User.findOneAndUpdate(
        { email: normalizedEmail },
        { 
          resetPasswordToken: resetToken,
          resetPasswordExpires: resetTokenExpiry
        },
        { new: false } // We don't need the updated document
      );
      
      if (!updateResult) {
        console.error(`[FORGOT-PASSWORD] Failed to update user with reset token for: ${normalizedEmail}`);
        throw new Error('Failed to save reset token to database');
      }
      
      console.log(`[FORGOT-PASSWORD] Reset token saved successfully for: ${normalizedEmail}`);
    } catch (updateError) {
      console.error('[FORGOT-PASSWORD] Error saving reset token:');
      console.error(`   Error: ${updateError.message || updateError.toString()}`);
      throw new Error(`Failed to save reset token: ${updateError.message}`);
    }

    // Create reset URL - use https for production/Render
    const frontendUrl = process.env.FRONTEND_URL || (process.env.RENDER ? 'https://findmypuppy.onrender.com' : 'http://localhost:5173');
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    
    console.log(`🔗 [FORGOT-PASSWORD] Reset URL generated: ${resetUrl.substring(0, 50)}...`);

    // Send email if transporter is configured
    if (!emailTransporter) {
      console.error('❌ [FORGOT-PASSWORD] Email transporter is not available');
      console.error('   This should not happen if environment variables are set correctly');
      console.error('   Check Render logs for email service initialization errors');
      console.log(`🔗 Fallback: Password reset link for ${user.email}: ${resetUrl}`);
      console.log('📤 [FORGOT-PASSWORD] Returning 500 error response to client...');
      const errorResponse = { 
        success: false, 
        message: "Email service is temporarily unavailable. Please try again later or contact support." 
      };
      console.log('📤 [FORGOT-PASSWORD] Error response:', JSON.stringify(errorResponse));
      return res.status(500).json(errorResponse);
    }

    const fromEmail = normalizeEnvValue(process.env.SMTP_USER || process.env.EMAIL_USER || '');
    
    // Validate email configuration before sending
    if (!fromEmail) {
      console.error('❌ [FORGOT-PASSWORD] Email configuration error: SMTP_USER or EMAIL_USER not set');
      console.error('   Check Render environment variables');
      console.log(`🔗 Fallback: Password reset link for ${user.email}: ${resetUrl}`);
      return res.status(500).json({ 
        success: false, 
        message: "Email service configuration error. Please contact support." 
      });
    }

    console.log(`📧 [FORGOT-PASSWORD] Preparing to send password reset email:`);
    console.log(`   To: ${user.email}`);
    console.log(`   From: ${fromEmail}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Render: ${process.env.RENDER ? 'true' : 'false'}`);
    console.log(`   Transporter available: ${emailTransporter !== null}`);
      
      const mailOptions = {
        from: `"Find My Puppy 🐾" <${fromEmail}>`,
        to: user.email,
        subject: '🔐 Let\'s Reset Your Password - Find My Puppy',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f7fa;">
            <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
              
              <!-- Header with Gradient -->
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -50px; right: -50px; width: 200px; height: 200px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
                <div style="position: absolute; bottom: -80px; left: -80px; width: 250px; height: 250px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
                <h1 style="color: white; margin: 0; font-size: 32px; font-weight: bold; position: relative; z-index: 1;">
                  🐾 Find My Puppy
                </h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1;">
                  Where Fun Meets Adventure!
                </p>
              </div>

              <!-- Main Content -->
              <div style="padding: 40px 30px;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <div style="font-size: 60px; margin-bottom: 10px;">🔐</div>
                  <h2 style="color: #333; margin: 0; font-size: 28px; font-weight: 600;">
                    Password Reset Request
                  </h2>
                </div>

                <p style="color: #555; line-height: 1.8; font-size: 16px; margin-bottom: 20px;">
                  Hey there, <strong style="color: #667eea;">${user.username}</strong>! 👋
                </p>

                <p style="color: #555; line-height: 1.8; font-size: 16px; margin-bottom: 20px;">
                  Looks like you've forgotten your password - no worries, it happens to the best of us! 🐶 We're here to help you get back into your Find My Puppy account so you can continue your fun adventures.
                </p>

                <div style="background: linear-gradient(135deg, #f8f9ff 0%, #fff5ff 100%); border-left: 4px solid #667eea; padding: 20px; border-radius: 8px; margin: 30px 0;">
                  <p style="color: #555; line-height: 1.8; font-size: 15px; margin: 0;">
                    <strong style="color: #667eea;">📝 Quick Steps:</strong><br>
                    1. Click the big button below<br>
                    2. Create a new secure password<br>
                    3. Get back to finding those adorable puppies! 🎉
                  </p>
                </div>

                <!-- Reset Button -->
                <div style="text-align: center; margin: 40px 0;">
                  <a href="${resetUrl}" 
                     style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 18px 50px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4); transition: transform 0.2s; letter-spacing: 0.5px;">
                    🔑 Reset My Password
                  </a>
                </div>

                <!-- Alternative Link Section -->
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 30px 0;">
                  <p style="color: #666; line-height: 1.6; font-size: 14px; margin: 0 0 12px 0; text-align: center;">
                    <strong>📎 Or copy and paste this link into your browser:</strong>
                  </p>
                  <p style="color: #667eea; word-break: break-all; font-size: 13px; background: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0; margin: 0; font-family: 'Courier New', monospace;">
                    ${resetUrl}
                  </p>
                </div>

                <!-- Important Notice -->
                <div style="background: #fff8e1; border: 2px solid #ffc107; border-radius: 8px; padding: 20px; margin: 30px 0;">
                  <p style="color: #856404; line-height: 1.7; font-size: 14px; margin: 0 0 10px 0;">
                    <strong style="font-size: 16px;">⏰ Important Reminders:</strong>
                  </p>
                  <ul style="color: #856404; line-height: 1.8; font-size: 14px; margin: 0; padding-left: 20px;">
                    <li>This link will <strong>expire in 1 hour</strong> for your security</li>
                    <li>If you <strong>didn't request</strong> this password reset, just ignore this email - your account is safe! 🛡️</li>
                    <li>Never share this link with anyone - we'll never ask for it!</li>
                  </ul>
                </div>

                <!-- Help Section -->
                <div style="text-align: center; margin-top: 30px; padding-top: 30px; border-top: 1px solid #e0e0e0;">
                  <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                    Having trouble clicking the button? 🤔
                  </p>
                  <p style="color: #888; font-size: 14px; line-height: 1.6; margin: 0;">
                    Simply copy the link above and paste it into your web browser's address bar.
                  </p>
                </div>

                <!-- Fun Footer Message -->
                <div style="text-align: center; margin-top: 30px; padding: 20px; background: linear-gradient(135deg, #f8f9ff 0%, #fff5ff 100%); border-radius: 8px;">
                  <p style="color: #667eea; font-size: 15px; font-weight: 600; margin: 0;">
                    🐕 Happy Puppy Hunting! 🐕
                  </p>
                  <p style="color: #888; font-size: 13px; margin: 8px 0 0 0;">
                    We can't wait to see you back in the game!
                  </p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background-color: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                <p style="color: #999; font-size: 12px; margin: 0 0 8px 0; line-height: 1.6;">
                  This email was sent to <strong style="color: #666;">${user.email}</strong>
                </p>
                <p style="color: #999; font-size: 12px; margin: 0;">
                  © ${new Date().getFullYear()} MVTechnology. All rights reserved.
                </p>
                <p style="color: #bbb; font-size: 11px; margin: 12px 0 0 0;">
                  Find My Puppy | Where Adventure Meets Fun 🎮
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
🔐 Password Reset Request - Find My Puppy

Hey there, ${user.username}! 👋

Looks like you've forgotten your password - no worries, it happens to the best of us! 🐶 We're here to help you get back into your Find My Puppy account so you can continue your fun adventures.

📝 Quick Steps:
1. Click the link below
2. Create a new secure password
3. Get back to finding those adorable puppies! 🎉

🔑 Reset Your Password:
${resetUrl}

⏰ Important Reminders:
- This link will expire in 1 hour for your security
- If you didn't request this password reset, just ignore this email - your account is safe! 🛡️
- Never share this link with anyone - we'll never ask for it!

Having trouble? Simply copy the link above and paste it into your web browser's address bar.

🐕 Happy Puppy Hunting! 🐕
We can't wait to see you back in the game!

---
This email was sent to ${user.email}
© ${new Date().getFullYear()} MVTechnology. All rights reserved.
Find My Puppy | Where Adventure Meets Fun 🎮
        `
      };

      // Send email and await so we only return success when the user's inbox receives the link
      const sendEmailAsync = async () => {
        const isProduction = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
        // Use longer timeout for production to handle Gmail SMTP slowness on cloud platforms
        const sendTimeout = isProduction ? 120000 : 30000; // 120s (2 min) for production, 30s for dev
        let lastError = null;
        
        // Try sending with current transporter first
        // If it fails with timeout/connection error, try creating a new transporter with port 465
        const currentPort = parseInt(process.env.SMTP_PORT || (isProduction ? '465' : '587'));
        const trySendEmail = async (attempt = 1, maxAttempts = 3, useFallbackPort = false) => {
          try {
            let transporterToUse = emailTransporter;
            
            // On second attempt in production, try port 465 as fallback if currently using 587
            if (attempt === 2 && isProduction && !useFallbackPort) {
              if (currentPort === 587) {
                console.log(`   🔄 [FALLBACK] Attempting to create new transporter with port 465 (SSL)...`);
                try {
                  const fallbackConfig = {
                    host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
                    port: 465,
                    secure: true, // Required for port 465
                    auth: {
                      user: fromEmail,
                      pass: normalizeAppPassword(process.env.SMTP_PASS || process.env.EMAIL_PASS || '')
                    },
                    tls: {
                      rejectUnauthorized: false
                    },
                    connectionTimeout: 120000,
                    socketTimeout: 120000,
                    greetingTimeout: 60000
                  };
                  transporterToUse = nodemailer.createTransport(fallbackConfig);
                  console.log(`   ✅ [FALLBACK] Created fallback transporter with port 465`);
                  useFallbackPort = true;
                } catch (fallbackError) {
                  console.error(`   ❌ [FALLBACK] Failed to create fallback transporter: ${fallbackError.message}`);
                }
              }
            }
            
            console.log(`📤 [FORGOT-PASSWORD] Attempt ${attempt}/${maxAttempts}: Sending password reset email to ${user.email}...`);
            console.log(`   Mail options prepared: from="${fromEmail}", to="${user.email}"`);
            
            // Log current SMTP configuration
            const currentSecure = process.env.SMTP_SECURE !== undefined 
              ? process.env.SMTP_SECURE === 'true' 
              : (isProduction ? true : false);
            console.log(`   [SMTP-CONFIG] Port: ${currentPort}, Secure: ${currentSecure}, Host: ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
            
            if (useFallbackPort) {
              console.log(`   Using fallback configuration: Port 465 with SSL`);
            } else if (currentPort === 587 && isProduction) {
              console.warn(`   ⚠️  [SMTP-CONFIG] WARNING: Using port 587 in production - Gmail may block this from Render IPs`);
              console.warn(`   ⚠️  [SMTP-CONFIG] RECOMMENDATION: Set SMTP_PORT=465 and SMTP_SECURE=true in Render`);
            }
            
            // Verify transporter is still valid before sending
            if (!transporterToUse || typeof transporterToUse.sendMail !== 'function') {
              throw new Error('Email transporter is not properly initialized');
            }
            
            const sendStartTime = Date.now();
            console.log(`   [EMAIL-SEND] Timeout set to ${sendTimeout}ms (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);
            
            // Log SMTP configuration being used
            const currentConfig = transporterToUse.options || {};
            console.log(`   [EMAIL-SEND] SMTP Config: Host=${currentConfig.host || 'unknown'}, Port=${currentConfig.port || 'unknown'}, Secure=${currentConfig.secure !== undefined ? currentConfig.secure : 'unknown'}`);
            console.log(`   [EMAIL-SEND] Starting sendMail() at ${new Date().toISOString()}...`);
            
            // Use AbortController for better timeout handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
              controller.abort();
            }, sendTimeout);
            
            let sendPromiseStarted = false;
            let timeoutTriggered = false;
            
            try {
              const sendPromise = transporterToUse.sendMail(mailOptions)
                .then((result) => {
                  if (timeoutTriggered) {
                    console.warn(`   ⚠️  [EMAIL-SEND] sendMail completed but timeout already triggered`);
                  }
                  return result;
                })
                .catch((err) => {
                  console.error(`   ❌ [EMAIL-SEND] sendMail promise rejected: ${err.message || err.code || err.toString()}`);
                  throw err;
                });
              
              sendPromiseStarted = true;
              console.log(`   [EMAIL-SEND] sendMail promise created, waiting for response...`);
              
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => {
                  timeoutTriggered = true;
                  console.error(`   ⏱️  [EMAIL-SEND] TIMEOUT triggered after ${sendTimeout/1000} seconds`);
                  console.error(`   ⏱️  [EMAIL-SEND] This usually means Gmail SMTP is blocking the connection`);
                  reject(new Error(`Email send timeout after ${sendTimeout/1000} seconds`));
                }, sendTimeout)
              );
              
              const info = await Promise.race([sendPromise, timeoutPromise]);
              clearTimeout(timeoutId);
              const sendDuration = Date.now() - sendStartTime;
              console.log(`   ✅ [EMAIL-SEND] Email send completed successfully in ${sendDuration}ms`);
              
              console.log(`✅ Password reset email sent successfully!`);
              console.log(`   Message ID: ${info.messageId || 'N/A'}`);
              console.log(`   To: ${user.email}`);
              console.log(`   From: ${fromEmail}`);
              console.log(`   Response: ${info.response || 'Email accepted by server'}`);
              console.log(`   Envelope: ${JSON.stringify(info.envelope || {})}`);
              
              // Additional production logging
              if (isProduction) {
                console.log(`   [PRODUCTION] Email sent at: ${new Date().toISOString()}`);
                console.log(`   [PRODUCTION] Reset URL: ${resetUrl.substring(0, 50)}...`);
              }
              
              return info; // Success
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (error) {
            lastError = error;
            
            // If connection/timeout error and we have retries left, try again
            if (attempt < maxAttempts && (
              error.code === 'ETIMEDOUT' || 
              error.code === 'ECONNECTION' || 
              error.code === 'ESOCKET' ||
              (error.message && error.message.includes('timeout'))
            )) {
              const retryDelay = attempt * 3000; // Exponential backoff: 3s, 6s, 9s
              console.warn(`   ⚠️  Connection/timeout error on attempt ${attempt}/${maxAttempts}`);
              console.warn(`   Error Code: ${error.code || 'NONE'}`);
              console.warn(`   Error Message: ${error.message || 'Unknown'}`);
              console.warn(`   Retrying in ${retryDelay}ms...`);
              
              // If timeout and we're on port 587, suggest switching to 465
              if (error.message && error.message.includes('timeout') && currentPort === 587) {
                console.warn(`   💡 SUGGESTION: Port 587 is likely blocked by Gmail from Render`);
                console.warn(`   💡 Set SMTP_PORT=465 and SMTP_SECURE=true in Render environment`);
              }
              
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              return trySendEmail(attempt + 1, maxAttempts, useFallbackPort);
            }
            
            throw error; // Re-throw if no more retries or different error
          }
        };
        
        try {
          await trySendEmail();
        } catch (emailError) {
        console.error('\n❌ ========== EMAIL SEND ERROR ==========');
        console.error(`[FORGOT-PASSWORD] Failed to send password reset email`);
        console.error(`   Timestamp: ${new Date().toISOString()}`);
        console.error(`   To: ${user.email}`);
        console.error(`   From: ${fromEmail}`);
        console.error(`   Error Type: ${emailError.constructor.name}`);
        console.error(`   Error Code: ${emailError.code || 'UNKNOWN'}`);
        console.error(`   Error Message: ${emailError.message || emailError.toString()}`);
        console.error(`   Environment: ${process.env.NODE_ENV || 'development'}`);
        console.error(`   Render: ${process.env.RENDER ? 'true' : 'false'}`);
        
        // Detailed error information
        if (emailError.response) {
          console.error(`   SMTP Response: ${emailError.response}`);
        }
        if (emailError.responseCode) {
          console.error(`   SMTP Response Code: ${emailError.responseCode}`);
        }
        if (emailError.command) {
          console.error(`   SMTP Command: ${emailError.command}`);
        }
        if (emailError.stack) {
          console.error(`   Stack Trace: ${emailError.stack}`);
        }
        
        // Check for common issues
        if (emailError.code === 'EAUTH' || emailError.responseCode === 535) {
          console.error('   🔐 Authentication Issue Detected:');
          console.error('      - Verify SMTP_USER and SMTP_PASS are set correctly in Render');
          console.error('      - Check that you are using a Gmail App Password');
          console.error('      - Ensure 2FA is enabled on your Google account');
        } else if (emailError.code === 'ETIMEDOUT' || emailError.code === 'ECONNECTION' || emailError.code === 'ESOCKET') {
          console.error('   🌐 Connection Issue Detected:');
          console.error('      - Gmail SMTP is likely blocking connections from Render IP addresses');
          console.error('      - This is a common issue with Gmail SMTP on cloud platforms');
          console.error('      - SOLUTIONS:');
          console.error('        1. Try port 465 with SMTP_SECURE=true (set in Render environment):');
          console.error('           SMTP_PORT=465');
          console.error('           SMTP_SECURE=true');
          console.error('        2. Check Render logs for specific connection errors');
          console.error('        3. Verify SMTP_USER and SMTP_PASS are correct');
          console.error('        5. Ensure you are using Gmail App Password (not regular password)');
        } else if (emailError.message && emailError.message.includes('timeout')) {
          console.error('   ⏱️  Timeout Issue Detected:');
          console.error('      - Gmail SMTP connection is timing out from Render');
          console.error('      - This usually means Gmail is blocking the connection');
          console.error('      - RECOMMENDED FIX: Use port 465 with SSL:');
          console.error('         Set in Render environment variables:');
          console.error('         SMTP_PORT=465');
          console.error('         SMTP_SECURE=true');
          console.error('      - Current config: Port ' + (process.env.SMTP_PORT || '587') + ', Secure: ' + (process.env.SMTP_SECURE || 'false'));
        }
        
        // Log the reset URL prominently for manual retrieval if email fails
        console.error(`🔗 [FORGOT-PASSWORD] IMPORTANT: Reset URL (use this if email fails):`);
        console.error(`   ${resetUrl}`);
        console.error('❌ ===========================================\n');
        throw emailError;
        }
      };

      // Await email send so we only return success when the registered email receives the link
      await sendEmailAsync();

      console.log(`✅ [FORGOT-PASSWORD] Password reset email sent to ${user.email}`);
      console.log(`🔗 [FORGOT-PASSWORD] Reset URL: ${resetUrl}`);
      
      res.status(200).json({ 
        success: true, 
        message: "A password reset link has been sent to your email address. Please check your inbox." 
      });
  } catch (error) {
    console.error('\n❌ ========== FORGOT PASSWORD ENDPOINT ERROR ==========');
    console.error('[FORGOT-PASSWORD] Unhandled error in forgot-password endpoint');
    console.error(`   Error Type: ${error.constructor.name}`);
    console.error(`   Error Message: ${error.message || error.toString()}`);
    console.error(`   Error Stack: ${error.stack || 'No stack trace available'}`);
    console.error(`   Timestamp: ${new Date().toISOString()}`);
    console.error(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.error(`   Render: ${process.env.RENDER ? 'true' : 'false'}`);
    
    // Check for specific error types
    if (error.name === 'MongoError' || error.name === 'MongooseError') {
      console.error('   🔴 Database Error Detected');
      console.error('      - Check MongoDB connection');
      console.error('      - Verify MONGO_URI is set correctly in Render');
    }
    
    if (error.message && error.message.includes('User is not defined')) {
      console.error('   🔴 Model Error: User model not available');
      console.error('      - Check if mongoose connection is established');
      console.error('      - Verify User model is properly defined');
    }
    
    console.error('❌ ===================================================\n');
    
    // User-friendly message when email send failed so they know to try again or check config
    const isEmailSendError = error.code === 'EAUTH' || error.code === 'ETIMEDOUT' || 
      error.code === 'ECONNECTION' || error.code === 'ESOCKET' ||
      (error.message && (error.message.includes('Email') || error.message.includes('timeout') || error.message.includes('SMTP')));
    const userMessage = isEmailSendError
      ? "We couldn't send the reset email. Please try again in a few minutes or contact support."
      : "Server error processing password reset request.";
    
    res.status(500).json({ 
      success: false, 
      message: userMessage,
      ...(process.env.NODE_ENV !== 'production' && {
        error: error.message,
        errorType: error.constructor.name
      })
    });
  }
});

// Password Reset Endpoint
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Log request for debugging (especially in production)
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
      console.log(`[RESET-PASSWORD] Request received`);
      console.log(`   Token provided: ${token ? 'Yes' : 'No'} (length: ${token ? token.length : 0})`);
      console.log(`   Password provided: ${newPassword ? 'Yes' : 'No'} (length: ${newPassword ? newPassword.length : 0})`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Render: ${process.env.RENDER ? 'true' : 'false'}`);
    }

    if (!token || !newPassword) {
      console.error('[RESET-PASSWORD] Missing required fields');
      return res.status(400).json({ success: false, message: "Token and new password are required." });
    }

    if (newPassword.length < 6) {
      console.error(`[RESET-PASSWORD] Password too short: ${newPassword.length} characters`);
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
    }

    // Find user with valid reset token (optimized query)
    const queryStartTime = Date.now();
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() } // Token not expired
    })
      .select('username email resetPasswordToken resetPasswordExpires password')
      .lean();
    
    const queryTime = Date.now() - queryStartTime;
    if (queryTime > 100) {
      console.log(`[PERFORMANCE] Token lookup took ${queryTime}ms`);
    }

    if (!user) {
      console.error(`[RESET-PASSWORD] Invalid or expired token`);
      console.error(`   Token (first 10 chars): ${token.substring(0, 10)}...`);
      console.error(`   Current time: ${new Date().toISOString()}`);
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired reset token. Please request a new password reset link." 
      });
    }

    console.log(`[RESET-PASSWORD] Token validated for user: ${user.username || user.email}`);

    // Hash new password
    const hashStartTime = Date.now();
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const hashTime = Date.now() - hashStartTime;
    if (hashTime > 100) {
      console.log(`[PERFORMANCE] Password hashing took ${hashTime}ms`);
    }

    // Update password and clear reset token using findOneAndUpdate for efficiency
    await User.findOneAndUpdate(
      { resetPasswordToken: token },
      { 
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null
      },
      { new: false }
    );

    console.log(`✅ [RESET-PASSWORD] Password reset successful for user: ${user.username || user.email}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);

    res.status(200).json({ 
      success: true, 
      message: "Password has been reset successfully. You can now login with your new password." 
    });
  } catch (error) {
    console.error('\n❌ ========== RESET PASSWORD ERROR ==========');
    console.error('[RESET-PASSWORD] Server error resetting password');
    console.error(`   Error Type: ${error.constructor.name}`);
    console.error(`   Error Message: ${error.message || error.toString()}`);
    console.error(`   Stack: ${error.stack || 'No stack trace'}`);
    console.error(`   Timestamp: ${new Date().toISOString()}`);
    console.error('❌ ===========================================\n');
    
    res.status(500).json({ 
      success: false, 
      message: "Server error resetting password. Please try again or request a new reset link." 
    });
  }
});

// Delete Account Permanently (requires username + password verification)
app.post('/api/auth/delete-account', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required." });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Google OAuth users without password must set one via forgot-password first
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google sign-in. Please use 'Forgot Password' to set a password first, then return here to delete your account.",
      });
    }

    if (!user.password) {
      return res.status(401).json({ success: false, message: "Invalid authentication method." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Delete related data first
    await PurchaseHistory.deleteMany({ username });
    await User.deleteOne({ username });

    console.log(`[DELETE-ACCOUNT] Account permanently deleted: ${username}`);
    res.status(200).json({
      success: true,
      message: "Your account has been permanently deleted.",
    });
  } catch (error) {
    console.error("[DELETE-ACCOUNT] Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting account. Please try again later.",
    });
  }
});

// Google OAuth Sign In Endpoint
app.post('/api/auth/google/signin', async (req, res) => {
  try {
    const { idToken, referralCode } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: "Google ID token is required." });
    }

    if (!googleClient) {
      console.error('Google sign-in attempted but GOOGLE_CLIENT_ID is not set (e.g. on Render set it in Environment).');
      return res.status(503).json({
        success: false,
        message: "Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID in the server environment (e.g. Render dashboard)."
      });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ success: false, message: "Invalid Google token." });
    }

    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists with this Google ID
    let user = await User.findOne({ googleId });

    if (user && user.banned) {
      return res.status(403).json({ success: false, message: "This account has been banned." });
    }

    if (!user) {
      // User doesn't exist by googleId - check if email exists (e.g. signed up with email/password)
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        if (existingUser.banned) {
          return res.status(403).json({ success: false, message: "This account has been banned." });
        }
        // Link Google to existing account: same user can sign in with password or Google
        existingUser.googleId = googleId;
        existingUser.lastLogin = new Date();
        await existingUser.save();

        return res.status(200).json({
          success: true,
          message: "Account linked! You can now sign in with Google or password.",
          user: {
            username: existingUser.username,
            email: existingUser.email,
            hints: existingUser.hints || 0,
            points: existingUser.points || 0,
            premium: existingUser.premium || false,
            levelPassedEasy: existingUser.levelPassedEasy || 0,
            levelPassedMedium: existingUser.levelPassedMedium || 0,
            levelPassedHard: existingUser.levelPassedHard || 0,
            referredBy: existingUser.referredBy || "",
            puppyRunHighScore: existingUser.puppyRunHighScore || 0
          }
        });
      }

      // Create new user with Google OAuth
      // Generate username from name or email
      const baseUsername = name?.replace(/\s+/g, '').toLowerCase() || email.split('@')[0];
      let username = baseUsername;
      let counter = 1;

      // Ensure username is unique
      while (await User.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      // Handle Referral Logic (same as regular signup)
      let referrerUser = null;
      let finalReferredByCode = null;

      if (referralCode && referralCode.trim() !== "") {
        const codeToUse = referralCode.trim();
        if (codeToUse.length > 4) {
          const extractedUsername = codeToUse.slice(0, -4);
          referrerUser = await User.findOne({ 
            username: { $regex: new RegExp(`^${extractedUsername}$`, 'i') } 
          });
          
          if (referrerUser) {
            finalReferredByCode = codeToUse;
            console.log(`✅ Google OAuth Referrer found: "${referrerUser.username}"`);
          }
        }
      }

      const initialHints = referrerUser ? 25 : 0;

      user = new User({
        username,
        email,
        googleId,
        authProvider: 'google',
        hints: initialHints,
        points: 0,
        premium: false,
        levelPassedEasy: 0,
        levelPassedMedium: 0,
        levelPassedHard: 0,
        referredBy: finalReferredByCode ? String(finalReferredByCode) : ""
      });

      await user.save();

      // Reward the referrer if applicable
      if (referrerUser) {
        referrerUser.hints = (referrerUser.hints || 0) + 25;
        await referrerUser.save();
        
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
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      return res.status(200).json({
        success: true,
        message: finalReferredByCode 
          ? "Account created with Google! You received 25 bonus hints for being referred."
          : "Account created with Google successfully!",
        user: {
          username: user.username,
          email: user.email,
          hints: user.hints || 0,
          points: user.points || 0,
          premium: user.premium || false,
          levelPassedEasy: user.levelPassedEasy || 0,
          levelPassedMedium: user.levelPassedMedium || 0,
          levelPassedHard: user.levelPassedHard || 0,
          referredBy: user.referredBy || "",
          puppyRunHighScore: user.puppyRunHighScore || 0
        }
      });
    }

    // Existing user - just sign in
    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: "Sign in with Google successful!",
      user: {
        username: user.username,
        email: user.email,
        hints: user.hints || 0,
        points: user.points || 0,
        premium: user.premium || false,
        levelPassedEasy: user.levelPassedEasy || 0,
        levelPassedMedium: user.levelPassedMedium || 0,
        levelPassedHard: user.levelPassedHard || 0,
        referredBy: user.referredBy || "",
        puppyRunHighScore: user.puppyRunHighScore || 0
      }
    });
  } catch (error) {
    console.error('Google OAuth Sign In Error:', error);
    const isTokenError = error?.message?.includes('Token') || error?.message?.includes('audience') || error?.message?.includes('verify');
    const message = isTokenError
      ? "Invalid or expired Google sign-in. Try signing in again."
      : "Server error during Google sign in. If this persists, check server logs and GOOGLE_CLIENT_ID.";
    res.status(isTokenError ? 401 : 500).json({ success: false, message });
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

// Get Daily Check-In Status (Puppy Growth)
app.get('/api/daily-checkin/status/:username', async (req, res) => {
  try {
    const { username } = req.params;
    // Optimize: use lean() for faster read-only access
    const user = await User.findOne({ username }).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const hasCheckedInToday = user.lastCheckInDate === todayString;

    // Calculate puppy age and size based on streak
    const puppyAge = Math.min(user.checkInStreak || 0, 7); // Age 0-7 days
    const puppySize = 1.0 + (puppyAge * 0.14); // Size grows from 1.0 to ~2.0 over 7 days

    const getISOWeek = (d) => {
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 4 - (date.getDay() || 7));
      const yearStart = new Date(date.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
      return `${date.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    };
    const thisWeek = getISOWeek(today);
    const hasUsedFreezeThisWeek = (user.streakFreezeWeek || '') === thisWeek;

    res.status(200).json({
      success: true,
      lastCheckInDate: user.lastCheckInDate || null,
      checkInStreak: user.checkInStreak || 0,
      totalCheckIns: user.totalCheckIns || 0,
      hasCheckedInToday,
      today: todayString,
      puppyAge,
      puppySize,
      hasUsedFreezeThisWeek,
      streakFreezeAvailable: !hasUsedFreezeThisWeek
    });
  } catch (error) {
    console.error('Get Daily Check-In Status Error:', error);
    res.status(500).json({ success: false, message: "Server error getting daily check-in status." });
  }
});

// Feed Puppy / Complete Daily Check-In
app.post('/api/daily-checkin/complete', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required." });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    // Check if already completed today
    if (user.lastCheckInDate === todayString) {
      const puppyAge = Math.min(user.checkInStreak || 0, 7);
      const puppySize = 1.0 + (puppyAge * 0.14);
      return res.status(200).json({
        success: true,
        message: "Puppy already fed today!",
        lastCheckInDate: user.lastCheckInDate,
        checkInStreak: user.checkInStreak,
        puppyAge,
        puppySize,
        hintsEarned: 0,
        pointsEarned: 0,
        totalHints: user.hints || 0,
        totalPoints: user.points || 0
      });
    }

    // Get ISO week string (e.g. "2025-W06") for streak freeze - one freeze per week
    const getISOWeek = (d) => {
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 4 - (date.getDay() || 7));
      const yearStart = new Date(date.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
      return `${date.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    };
    const thisWeek = getISOWeek(today);

    // Calculate streak (with optional streak freeze: one per week when user missed exactly 1 day)
    let newStreak = 1;
    let usedFreeze = false;
    if (user.lastCheckInDate) {
      const lastCheckIn = new Date(user.lastCheckInDate);
      const daysDiff = Math.floor((today.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        // Consecutive day - increment streak
        newStreak = (user.checkInStreak || 0) + 1;
      } else if (daysDiff === 2) {
        // Missed exactly one day - allow streak freeze once per week
        const freezeUsedThisWeek = (user.streakFreezeWeek || '') === thisWeek;
        if (!freezeUsedThisWeek) {
          newStreak = (user.checkInStreak || 0) + 1;
          usedFreeze = true;
          user.streakFreezeWeek = thisWeek;
        } else {
          newStreak = 1;
        }
      } else if (daysDiff > 1) {
        newStreak = 1;
      }
    }

    // Calculate puppy age (0-7 days, cycles)
    const puppyAge = Math.min(newStreak, 7);
    const puppySize = 1.0 + (puppyAge * 0.14); // Size grows from 1.0 to ~2.0 over 7 days

    // Calculate rewards based on streak milestones (only on milestone day)
    let hintsEarned = 0;
    let pointsEarned = 0;
    let milestone = null;
    
    // 7 days streak = 10 hints (only on day 7)
    if (newStreak === 7) {
      hintsEarned = 10;
      milestone = '7days';
    }
    // 30 days streak = 50 points (only on day 30)
    else if (newStreak === 30) {
      pointsEarned = 50;
      milestone = '30days';
    }
    // 365 days (1 year) streak = 1000 hints (only on day 365)
    else if (newStreak === 365) {
      hintsEarned = 1000;
      milestone = '1year';
    }

    // Update user data
    user.lastCheckInDate = todayString;
    user.checkInStreak = newStreak;
    user.totalCheckIns = (user.totalCheckIns || 0) + 1;
    user.puppyAge = puppyAge;
    user.puppySize = puppySize;
    
    if (hintsEarned > 0) {
      user.hints = (user.hints || 0) + hintsEarned;
    }
    if (pointsEarned > 0) {
      user.points = (user.points || 0) + pointsEarned;
    }

    await user.save();

    // Check achievements after daily check-in (for streak achievements)
    const currentAchievements = user.achievements || [];
    const streakAchievementsToUnlock = [];
    if (newStreak >= 7 && !currentAchievements.includes('streak_7')) streakAchievementsToUnlock.push('streak_7');
    if (newStreak >= 30 && !currentAchievements.includes('streak_30')) streakAchievementsToUnlock.push('streak_30');
    if (streakAchievementsToUnlock.length > 0) {
      user.achievements = [...new Set([...currentAchievements, ...streakAchievementsToUnlock])];
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: hintsEarned > 0 
        ? `Puppy fed! 🎉 +${hintsEarned} hints earned!`
        : pointsEarned > 0
        ? `Puppy fed! 🎉 +${pointsEarned} points earned!`
        : usedFreeze
        ? "Puppy fed! 🧊 Streak saved with freeze!"
        : "Puppy fed! 🐕",
      lastCheckInDate: user.lastCheckInDate,
      checkInStreak: user.checkInStreak,
      puppyAge,
      puppySize,
      hintsEarned,
      pointsEarned,
      totalHints: user.hints || 0,
      totalPoints: user.points || 0,
      milestone: newStreak === 7 ? '7days' : newStreak === 30 ? '30days' : newStreak === 365 ? '1year' : null,
      usedStreakFreeze: usedFreeze,
      newlyUnlockedAchievements: streakAchievementsToUnlock
    });
  } catch (error) {
    console.error('Complete Daily Check-In Error:', error);
    res.status(500).json({ success: false, message: "Server error completing daily check-in." });
  }
});

// Daily Puzzle / Daily Run - get status (has completed today?)
app.get('/api/daily-puzzle/status/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username }).select('lastDailyPuzzleDate').lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const hasCompletedToday = ALLOW_MULTIPLE_DAILY_RUNS ? false : (user.lastDailyPuzzleDate === todayString);
    res.status(200).json({
      success: true,
      hasCompletedToday,
      lastCompletedDate: user.lastDailyPuzzleDate || null
    });
  } catch (error) {
    console.error('Daily puzzle status error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Comeback bonus - claim 5 hints if user was away 7+ days (one-time per absence)
app.post('/api/comeback-bonus/claim', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if (user.comebackBonusClaimed) {
      return res.status(200).json({ success: false, message: "Already claimed.", totalHints: user.hints || 0 });
    }
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const lastPlayed = user.lastPlayedAt || user.lastLogin || user.createdAt;
    if (lastPlayed && lastPlayed > sevenDaysAgo) {
      return res.status(200).json({ success: false, message: "Come back after 7 days away to claim.", totalHints: user.hints || 0 });
    }
    const bonusHints = 5;
    user.hints = (user.hints || 0) + bonusHints;
    user.comebackBonusClaimed = true;
    user.lastPlayedAt = new Date();
    await user.save();
    res.status(200).json({
      success: true,
      message: `Welcome back! +${bonusHints} hints!`,
      hintsEarned: bonusHints,
      totalHints: user.hints
    });
  } catch (error) {
    console.error('Comeback bonus claim error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Check if user is eligible for comeback bonus (for UI)
app.get('/api/comeback-bonus/eligibility/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username }).select('lastPlayedAt lastLogin createdAt comebackBonusClaimed').lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const lastPlayed = user.lastPlayedAt || user.lastLogin || user.createdAt;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const eligible = !user.comebackBonusClaimed && lastPlayed && lastPlayed < sevenDaysAgo;
    res.status(200).json({ success: true, eligible });
  } catch (error) {
    console.error('Comeback bonus eligibility error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Daily Puzzle / Daily Run - complete (grant reward: 3 hints)
app.post('/api/daily-puzzle/complete', async (req, res) => {
  try {
    const { username, puzzleId, score } = req.body;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!ALLOW_MULTIPLE_DAILY_RUNS && user.lastDailyPuzzleDate === todayString) {
      return res.status(200).json({
        success: true,
        message: "Already completed today's run!",
        hintsEarned: 0,
        totalHints: user.hints || 0
      });
    }
    
    // Calculate hints based on score
    let hintsReward = 0;
    const runScore = score || 0;
    
    if (runScore >= 1001) {
      hintsReward = 5;
    } else if (runScore >= 501) {
      hintsReward = 2;
    } else if (runScore >= 1) {
      hintsReward = 1;
    } else {
      hintsReward = 0;
    }

    // Update high score if current run is better
    if (runScore > (user.puppyRunHighScore || 0)) {
      user.puppyRunHighScore = runScore;
    }

    user.lastDailyPuzzleDate = todayString;
    user.hints = (user.hints || 0) + hintsReward;
    await user.save();
    res.status(200).json({
      success: true,
      message: `Run complete! +${hintsReward} hints!`,
      hintsEarned: hintsReward,
      totalHints: user.hints,
      highScore: user.puppyRunHighScore
    });
  } catch (error) {
    console.error('Daily puzzle complete error:', error);
    res.status(500).json({ success: false, message: "Server error." });
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
    user.lastPlayedAt = new Date();

    const thisWeek = getISOWeekString();
    if (user.weeklyChallengeWeek !== thisWeek) {
      user.weeklyChallengeWeek = thisWeek;
      user.weeklyChallengeProgress = { easy: 0, medium: 0, hard: 0 };
      user.weeklyChallengeClaimed = false;
    }
    const prog = user.weeklyChallengeProgress || { easy: 0, medium: 0, hard: 0 };
    if (difficulty === 'Easy') prog.easy = (prog.easy || 0) + 1;
    else if (difficulty === 'Medium') prog.medium = (prog.medium || 0) + 1;
    else if (difficulty === 'Hard') prog.hard = (prog.hard || 0) + 1;
    user.weeklyChallengeProgress = prog;

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
    // Optimize: use lean() and ensure index is used
    const purchases = await PurchaseHistory.find({ 
      username,
      purchaseMode: { $in: ['Money', 'Referral'] }
    })
      .sort({ purchaseDate: -1 }) // Most recent first
      .lean()
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

// Leaderboard endpoint - Get top 10 users by points (excluding zero points)
// ISO week string helper (e.g. "2025-W06") - used by streak freeze and weekly challenge
function getISOWeekString() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Level of the day - deterministic level + difficulty for 2x points (client applies multiplier)
app.get('/api/level-of-day', (req, res) => {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      const c = dateStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash;
    }
    const levelId = (Math.abs(hash) % 100) + 1;
    const diffIndex = Math.floor(Math.abs(hash) / 100) % 3;
    const difficulties = ['Easy', 'Medium', 'Hard'];
    res.status(200).json({
      success: true,
      levelId,
      difficulty: difficulties[diffIndex],
      date: dateStr
    });
  } catch (error) {
    console.error('Level of day error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Achievements - list definitions (static)
const ACHIEVEMENT_DEFINITIONS = [
  { id: 'first_level', name: 'First Steps', desc: 'Clear your first level', icon: '🌟' },
  { id: 'easy_10', name: 'Easy Explorer', desc: 'Clear 10 Easy levels', icon: '🐕' },
  { id: 'easy_50', name: 'Easy Master', desc: 'Clear 50 Easy levels', icon: '🏅' },
  { id: 'medium_10', name: 'Medium Explorer', desc: 'Clear 10 Medium levels', icon: '🐶' },
  { id: 'hard_5', name: 'Hard Starter', desc: 'Clear 5 Hard levels', icon: '🔥' },
  { id: 'streak_7', name: 'Week Warrior', desc: '7-day check-in streak', icon: '📅' },
  { id: 'streak_30', name: 'Monthly Champion', desc: '30-day check-in streak', icon: '👑' },
  { id: 'referral_1', name: 'Friend Inviter', desc: 'Refer 1 friend who signed up', icon: '🤝' },
  { id: 'no_hint_clear', name: 'Sharp Eyes', desc: 'Clear a level without using hints', icon: '👁️' }
];

app.get('/api/achievements', (req, res) => {
  res.status(200).json({ success: true, achievements: ACHIEVEMENT_DEFINITIONS });
});

// Achievements - check and unlock (call after level clear, login, or check-in)
app.post('/api/achievements/check', async (req, res) => {
  try {
    const { username, noHintsUsed } = req.body;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const current = user.achievements || [];
    const easy = user.levelPassedEasy || 0;
    const medium = user.levelPassedMedium || 0;
    const hard = user.levelPassedHard || 0;
    const streak = user.checkInStreak || 0;
    const referredCount = await User.countDocuments({ referredBy: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{4}$`) });
    const toUnlock = [];
    
    // Level-based achievements
    if (easy >= 1 && !current.includes('first_level')) toUnlock.push('first_level');
    if (easy >= 10 && !current.includes('easy_10')) toUnlock.push('easy_10');
    if (easy >= 50 && !current.includes('easy_50')) toUnlock.push('easy_50');
    if (medium >= 10 && !current.includes('medium_10')) toUnlock.push('medium_10');
    if (hard >= 5 && !current.includes('hard_5')) toUnlock.push('hard_5');
    
    // Streak achievements
    if (streak >= 7 && !current.includes('streak_7')) toUnlock.push('streak_7');
    if (streak >= 30 && !current.includes('streak_30')) toUnlock.push('streak_30');
    
    // Referral achievement
    if (referredCount >= 1 && !current.includes('referral_1')) toUnlock.push('referral_1');
    
    // Sharp Eyes achievement - clear level without using hints
    if (noHintsUsed === true && !current.includes('no_hint_clear')) {
      toUnlock.push('no_hint_clear');
    }
    
    if (toUnlock.length > 0) {
      user.achievements = [...new Set([...current, ...toUnlock])];
      await user.save();
    }
    res.status(200).json({
      success: true,
      achievements: user.achievements || [],
      newlyUnlocked: toUnlock
    });
  } catch (error) {
    console.error('Achievements check error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Weekly challenge - get current challenge and progress
app.get('/api/weekly-challenge', async (req, res) => {
  try {
    const { username } = req.query;
    const thisWeek = getISOWeekString();
    const target = { total: 5 };
    if (!username) {
      return res.status(200).json({ success: true, week: thisWeek, target, progress: { easy: 0, medium: 0, hard: 0 }, totalProgress: 0, claimed: false });
    }
    const user = await User.findOne({ username }).select('weeklyChallengeWeek weeklyChallengeProgress weeklyChallengeClaimed').lean();
    let progress = { easy: 0, medium: 0, hard: 0 };
    let claimed = false;
    if (user) {
      if (user.weeklyChallengeWeek === thisWeek) {
        progress = user.weeklyChallengeProgress || progress;
        if (typeof progress.easy !== 'number') progress.easy = 0;
        if (typeof progress.medium !== 'number') progress.medium = 0;
        if (typeof progress.hard !== 'number') progress.hard = 0;
        claimed = user.weeklyChallengeClaimed || false;
      }
    }
    const totalProgress = (progress.easy || 0) + (progress.medium || 0) + (progress.hard || 0);
    res.status(200).json({
      success: true,
      week: thisWeek,
      target,
      progress,
      totalProgress,
      claimed
    });
  } catch (error) {
    console.error('Weekly challenge get error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Weekly challenge - claim reward (5 hints) when totalProgress >= 5 and not yet claimed
app.post('/api/weekly-challenge/claim', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: "Username required." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    const thisWeek = getISOWeekString();
    if (user.weeklyChallengeWeek !== thisWeek) {
      user.weeklyChallengeWeek = thisWeek;
      user.weeklyChallengeProgress = { easy: 0, medium: 0, hard: 0 };
      user.weeklyChallengeClaimed = false;
    }
    const prog = user.weeklyChallengeProgress || { easy: 0, medium: 0, hard: 0 };
    const total = (prog.easy || 0) + (prog.medium || 0) + (prog.hard || 0);
    if (total < 5) {
      return res.status(400).json({ success: false, message: "Clear 5 levels this week to claim.", totalHints: user.hints || 0 });
    }
    if (user.weeklyChallengeClaimed) {
      return res.status(200).json({ success: false, message: "Already claimed.", totalHints: user.hints || 0 });
    }
    const rewardHints = 5;
    user.hints = (user.hints || 0) + rewardHints;
    user.weeklyChallengeClaimed = true;
    await user.save();
    res.status(200).json({
      success: true,
      message: `Weekly challenge complete! +${rewardHints} hints!`,
      hintsEarned: rewardHints,
      totalHints: user.hints
    });
  } catch (error) {
    console.error('Weekly challenge claim error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Referral leaderboard - top referrers by count of referred users
app.get('/api/leaderboard/referrals', async (req, res) => {
  try {
    const agg = await User.aggregate([
      { $match: { referredBy: { $exists: true, $ne: null, $ne: "" } } },
      { $group: { _id: "$referredBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { referrerUsername: "$_id", referredCount: "$count", _id: 0 } }
    ]);
    const leaderboard = agg.map((row, index) => ({
      username: row.referrerUsername,
      rank: index + 1,
      referredCount: row.referredCount
    }));
    res.status(200).json({ success: true, leaderboard });
  } catch (error) {
    console.error('Referral leaderboard error:', error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const { username } = req.query; // Get current username from query params
    
    // Get all users with points > 0, sorted by points descending (for top 10)
    const usersWithPoints = await User.find({ points: { $gt: 0 } })
      .select('username points')
      .sort({ points: -1 })
      .lean();

    // Get top 10 users
    const topUsers = usersWithPoints.slice(0, 10);

    // Add rank to each user in top 10
    const leaderboard = topUsers.map((user, index) => ({
      username: user.username,
      rank: index + 1,
      points: user.points || 0
    }));

    // If username is provided, find their rank and data
    let currentUserRank = null;
    if (username) {
      // Find current user in the database (including those with 0 points)
      const currentUserDoc = await User.findOne({ username: username.trim() })
        .select('username points')
        .lean();
      
      if (currentUserDoc) {
        const currentUserPoints = currentUserDoc.points || 0;
        
        // Check if current user is in top 10
        const isInTop10 = topUsers.some(user => user.username === currentUserDoc.username);
        
        // Only include current user if they're NOT in top 10
        if (!isInTop10) {
          // Calculate their rank: count how many users have more points
          const usersAbove = usersWithPoints.filter(user => user.points > currentUserPoints).length;
          const rank = usersAbove + 1; // Rank is 1-based
          
          currentUserRank = {
            username: currentUserDoc.username,
            rank: rank,
            points: currentUserPoints
          };
        }
      }
    }

    res.json({
      success: true,
      leaderboard: leaderboard,
      currentUser: currentUserRank // Will be null if user is in top 10 or not found
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard'
    });
  }
});

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

    // Optimize: use lean() for faster read-only access
    const user = await User.findOne({ username }).lean();
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
        referredBy: user.referredBy || "",
        lastPlayedAt: user.lastPlayedAt || null,
        comebackBonusClaimed: user.comebackBonusClaimed || false,
        achievements: user.achievements || [],
        unlockedThemes: user.unlockedThemes || ['sunny', 'night']
      } 
    });
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({ success: false, message: "Server error fetching user data." });
  }
});

// Get unlocked themes for a user
app.get('/api/user/:username/themes', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    res.status(200).json({ 
      success: true, 
      unlockedThemes: user.unlockedThemes || ['sunny', 'night']
    });
  } catch (error) {
    console.error('Get Themes Error:', error);
    res.status(500).json({ success: false, message: "Server error fetching themes." });
  }
});

// Unlock a theme (by games completed or points spent)
app.post('/api/user/:username/unlock-theme', async (req, res) => {
  try {
    const { username } = req.params;
    const { theme, unlockMethod } = req.body; // unlockMethod: 'games' or 'points'
    
    if (!theme) {
      return res.status(400).json({ success: false, message: "Theme is required." });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    
    // Ensure unlockedThemes exists
    if (!user.unlockedThemes || user.unlockedThemes.length < 2) {
      user.unlockedThemes = ['sunny', 'night'];
    }
    
    // Check if already unlocked
    if (user.unlockedThemes.includes(theme)) {
      return res.status(200).json({ 
        success: true, 
        message: "Theme already unlocked.",
        unlockedThemes: user.unlockedThemes
      });
    }
    
    // If unlocking with points, check balance
    if (unlockMethod === 'points') {
      const THEME_UNLOCK_COST = 25;
      if ((user.points || 0) < THEME_UNLOCK_COST) {
        return res.status(400).json({ 
          success: false, 
          message: `Not enough points. Need ${THEME_UNLOCK_COST} points to unlock this theme.` 
        });
      }
      // Deduct points
      user.points = (user.points || 0) - THEME_UNLOCK_COST;
    }
    
    // Unlock the theme
    user.unlockedThemes.push(theme);
    await user.save();
    
    res.status(200).json({ 
      success: true, 
      message: unlockMethod === 'points' 
        ? `Theme unlocked! ${25} points deducted.` 
        : "Theme unlocked!",
      unlockedThemes: user.unlockedThemes,
      points: user.points
    });
  } catch (error) {
    console.error('Unlock Theme Error:', error);
    res.status(500).json({ success: false, message: "Server error unlocking theme." });
  }
});

// Public game config (used by game client so admin changes reflect for all users)
app.get('/api/game-config', async (req, res) => {
  try {
    const [maintenanceDoc, gameConfigDoc] = await Promise.all([
      MaintenanceMode.findOne({ configKey: 'default' }).lean(),
      GameConfig.findOne({ configKey: 'default' }).lean(),
    ]);
    if (maintenanceDoc && maintenanceDoc.enabled) {
      return res.status(200).json({
        success: true,
        maintenance: {
          enabled: true,
          message: maintenanceDoc.message || 'Under maintenance. Please try again later.',
        },
        gameConfig: null,
        priceOffer: null,
      });
    }
    let gameConfig = gameConfigDoc;
    if (!gameConfig) {
      gameConfig = {
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
      };
    }
    const offer = await PriceOffer.findOne({ hintPack: '100 Hints Pack' }).lean();
    const priceOffer = offer ? {
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
    res.status(200).json({
      success: true,
      maintenance: { enabled: false, message: null },
      gameConfig: {
        puppyCountEasy: gameConfig.puppyCountEasy,
        puppyCountMedium: gameConfig.puppyCountMedium,
        puppyCountHard: gameConfig.puppyCountHard,
        timerMediumSeconds: gameConfig.timerMediumSeconds,
        timerHardSeconds: gameConfig.timerHardSeconds,
        wrongTapLimit: gameConfig.wrongTapLimit,
        pointsPerLevelEasy: gameConfig.pointsPerLevelEasy,
        pointsPerLevelMedium: gameConfig.pointsPerLevelMedium,
        pointsPerLevelHard: gameConfig.pointsPerLevelHard,
        levelsEnabled: gameConfig.levelsEnabled !== false,
        timerEnabled: gameConfig.timerEnabled !== false,
      },
      priceOffer,
    });
  } catch (error) {
    console.error('Get game config error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching game config.' });
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

// Email Test Endpoint (for diagnostics - remove in production or add auth)
app.post('/api/auth/test-email', async (req, res) => {
  try {
    const { testEmail } = req.body;
    
    console.log('\n🧪 [TEST-EMAIL] Test email request received');
    console.log(`   Test Email: ${testEmail || 'not provided (will use fromEmail)'}`);
    console.log(`   Transporter available: ${emailTransporter !== null}`);
    
    if (!emailTransporter) {
      console.error('❌ [TEST-EMAIL] Email transporter not available');
      return res.status(503).json({ 
        success: false, 
        message: "Email service not configured. Set SMTP_USER and SMTP_PASS environment variables.",
        configured: false,
        troubleshooting: "Check Render environment variables and server startup logs"
      });
    }

    const fromEmail = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const toEmail = (testEmail || fromEmail).trim();
    
    if (!fromEmail) {
      console.error('❌ [TEST-EMAIL] From email not configured');
      return res.status(503).json({ 
        success: false, 
        message: "SMTP_USER or EMAIL_USER not set in environment variables.",
        configured: false
      });
    }

    console.log(`📧 [TEST-EMAIL] Preparing to send test email:`);
    console.log(`   From: ${fromEmail}`);
    console.log(`   To: ${toEmail}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Render: ${process.env.RENDER ? 'true' : 'false'}`);

    const testMailOptions = {
      from: `"Find My Puppy Test" <${fromEmail}>`,
      to: toEmail,
      subject: 'Test Email - Find My Puppy Email Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">🐾 Find My Puppy</h1>
          </div>
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Email Service Test</h2>
            <p style="color: #666; line-height: 1.6;">
              This is a test email to verify that the email service is working correctly.
            </p>
            <p style="color: #666; line-height: 1.6;">
              If you received this email, the email configuration is correct! ✅
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
              Sent at: ${new Date().toLocaleString()}<br>
              Environment: ${process.env.NODE_ENV || 'development'}<br>
              Render: ${process.env.RENDER ? 'true' : 'false'}
            </p>
          </div>
        </div>
      `,
      text: `Test Email - Find My Puppy Email Service\n\nThis is a test email to verify that the email service is working correctly.\n\nSent at: ${new Date().toLocaleString()}\nEnvironment: ${process.env.NODE_ENV || 'development'}`
    };

    console.log(`📤 [TEST-EMAIL] Sending test email...`);
    const sendStartTime = Date.now();
    
    const info = await emailTransporter.sendMail(testMailOptions);
    const sendTime = Date.now() - sendStartTime;
    
    console.log(`✅ [TEST-EMAIL] Test email sent successfully!`);
    console.log(`   Message ID: ${info.messageId || 'N/A'}`);
    console.log(`   Response: ${info.response || 'Email accepted by server'}`);
    console.log(`   Send time: ${sendTime}ms`);
    
    res.status(200).json({ 
      success: true, 
      message: `Test email sent successfully to ${toEmail}`,
      messageId: info.messageId,
      response: info.response,
      sendTime: `${sendTime}ms`,
      configured: true,
      fromEmail: fromEmail,
      toEmail: toEmail
    });
  } catch (error) {
    console.error('❌ [TEST-EMAIL] Failed to send test email');
    console.error(`   Error Type: ${error.constructor.name}`);
    console.error(`   Error Code: ${error.code || 'UNKNOWN'}`);
    console.error(`   Error Message: ${error.message || error.toString()}`);
    if (error.response) {
      console.error(`   SMTP Response: ${error.response}`);
    }
    if (error.responseCode) {
      console.error(`   SMTP Response Code: ${error.responseCode}`);
    }
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    
    res.status(500).json({ 
      success: false, 
      message: "Failed to send test email",
      error: error.message,
      code: error.code,
      responseCode: error.responseCode,
      response: error.response,
      configured: emailTransporter !== null,
      troubleshooting: {
        step1: "Check Render logs for detailed error information",
        step2: "Verify SMTP_USER and SMTP_PASS are set correctly",
        step3: "Ensure you're using a Gmail App Password (not regular password)",
        step4: "Check that 2FA is enabled on your Google account"
      }
    });
  }
});

// Email Configuration Status Endpoint
app.get('/api/auth/email-status', (req, res) => {
  const isConfigured = emailTransporter !== null;
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  const hasUser = !!smtpUser;
  const hasPass = !!smtpPass;
  const hasCredentials = hasUser && hasPass;
  
  // Mask password for security
  const maskedPass = smtpPass.length > 4 
    ? smtpPass.substring(0, 2) + '****' + smtpPass.substring(smtpPass.length - 2)
    : (hasPass ? '****' : 'Not set');
  
  res.status(200).json({
    configured: isConfigured,
    hasCredentials: hasCredentials,
    hasUser: hasUser,
    hasPass: hasPass,
    smtpHost: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
    smtpPort: parseInt(process.env.SMTP_PORT || '587'),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    fromEmail: smtpUser || 'Not set',
    passwordMasked: maskedPass,
    environment: process.env.NODE_ENV || 'development',
    isRender: !!process.env.RENDER,
    message: isConfigured 
      ? 'Email service is configured and ready'
      : hasCredentials
        ? 'Email service credentials found but transporter not created. Check server logs for details.'
        : 'Email service is not configured. Set SMTP_USER and SMTP_PASS environment variables in Render.',
    troubleshooting: !hasCredentials ? {
      step1: 'Go to your Render dashboard',
      step2: 'Navigate to your service → Environment',
      step3: 'Add environment variables: SMTP_USER and SMTP_PASS',
      step4: 'SMTP_USER should be your Gmail address',
      step5: 'SMTP_PASS should be a Gmail App Password (16 characters)',
      step6: 'Redeploy your service after adding variables'
    } : null
  });
});

// Password Reset Diagnostic Endpoint
app.get('/api/auth/password-reset-status', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || (process.env.RENDER ? 'https://findmypuppy.onrender.com' : 'http://localhost:5173');
  const emailConfigured = emailTransporter !== null;
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  
  res.status(200).json({
    passwordResetEnabled: emailConfigured && !!smtpUser && !!smtpPass,
    emailServiceConfigured: emailConfigured,
    frontendUrl: frontendUrl,
    resetUrlTemplate: `${frontendUrl}/reset-password?token=TOKEN_HERE`,
    environment: process.env.NODE_ENV || 'development',
    isRender: !!process.env.RENDER,
    checks: {
      emailTransporter: emailConfigured ? '✅ Available' : '❌ Not available',
      smtpUser: smtpUser ? `✅ Set (${smtpUser})` : '❌ Not set',
      smtpPass: smtpPass ? '✅ Set' : '❌ Not set',
      frontendUrl: frontendUrl ? `✅ ${frontendUrl}` : '❌ Not set'
    },
    troubleshooting: {
      ifEmailNotWorking: [
        '1. Check Render logs for email send errors',
        '2. Verify SMTP_USER and SMTP_PASS are set in Render environment',
        '3. Ensure you are using a Gmail App Password (not regular password)',
        '4. Test email service: POST /api/auth/test-email',
        '5. Check email status: GET /api/auth/email-status'
      ],
      ifResetLinkNotWorking: [
        '1. Verify FRONTEND_URL is set correctly in Render',
        '2. Check that the reset link uses https:// (not http://)',
        '3. Ensure the frontend route /reset-password exists',
        '4. Check browser console for CORS or network errors',
        '5. Verify the token is being passed correctly in the URL'
      ]
    }
  });
});

// Serve privacy policy page (accessible in both dev and production)
app.get('/privacy-policy.html', (req, res) => {
  if (isProduction) {
    res.sendFile(join(__dirname, '..', 'dist', 'privacy-policy.html'));
  } else {
    res.sendFile(join(__dirname, '..', 'public', 'privacy-policy.html'));
  }
});

app.get('/explorer-guide', (req, res) => {
  if (isProduction) {
    res.sendFile(join(__dirname, '..', 'dist', 'explorer-guide.html'));
  } else {
    res.sendFile(join(__dirname, '..', 'public', 'explorer-guide.html'));
  }
});

// Try to listen on PORT; if EADDRINUSE, try next port (5775, 5776, ...) until one is free
function startServer(tryPort) {
  const server = app.listen(tryPort, () => {
    const actualPort = server.address().port;
    console.log(`🚀 Backend Server running on http://localhost:${actualPort} (${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'})`);
  
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
    // Start the frontend dev server ONLY in development (pass backend port so proxy works if we fell back to 5775+)
    console.log('📦 Starting frontend dev server...');
    const viteProcess = spawn('npm', ['run', 'dev'], {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, VITE_API_PORT: String(actualPort) }
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

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${tryPort} in use, trying ${tryPort + 1}...`);
      startServer(tryPort + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);