import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render uses process.env.PORT. Fallback to 5177 for local testing.
const PORT = process.env.PORT || 5177;

// Middleware
// Allow CORS so your mobile app (which runs on a different origin) can hit this API
app.use(cors()); 
app.use(express.json());

// MongoDB Connectionßßß
// Use Environment Variable for security in production, fallback to string for local
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
  hints: { type: Number, default: 0 }, 
  points: { type: Number, default: 0 }, 
  premium: { type: Boolean, default: false }, 
  levelPassedEasy: { type: Number, default: 0 }, 
  levelPassedMedium: { type: Number, default: 0 }, 
  levelPassedHard: { type: Number, default: 0 }, 
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
}, { collection: COLLECTION_NAME });

const User = mongoose.model('User', userSchema);

const purchaseHistorySchema = new mongoose.Schema({
  username: { type: String, required: true },
  purchaseDate: { type: Date, default: Date.now },
  purchaseId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  purchaseType: { type: String, required: true, enum: ['Premium', 'Hints'] },
  pack: { type: String, required: true }, 
  purchaseMode: { type: String, enum: ['Money', 'Points', 'Referral'], default: 'Money' }
}, { collection: 'purchaseHistory' });

const PurchaseHistory = mongoose.model('PurchaseHistory', purchaseHistorySchema);

// --- API ROUTES ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found. Please sign up." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

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
        levelPassedHard: user.levelPassedHard || 0
      } 
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: "Server error during login." });
  }
});

app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Username, email, and password are required." });
    }
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Username or Email already exists." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      hints: 0,
      points: 0,
      premium: false,
      levelPassedEasy: 0,
      levelPassedMedium: 0,
      levelPassedHard: 0
    });
    await newUser.save();
    res.status(201).json({ success: true, message: "Account created successfully!", user: { username, email } });
  } catch (error) {
    console.error('Signup Error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Username or Email already exists." });
    }
    res.status(500).json({ success: false, message: "Server error during signup." });
  }
});

app.post('/api/user/update-hints', async (req, res) => {
  try {
    const { username, hints } = req.body;
    if (!username || hints === undefined) return res.status(400).json({ success: false, message: "Missing fields." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    user.hints = hints;
    await user.save();
    res.status(200).json({ success: true, message: "Hints updated", hints: user.hints });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/user/update-points', async (req, res) => {
  try {
    const { username, points } = req.body;
    if (!username || points === undefined) return res.status(400).json({ success: false, message: "Missing fields." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    user.points = points;
    await user.save();
    res.status(200).json({ success: true, message: "Points updated", points: user.points });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/user/update-premium', async (req, res) => {
  try {
    const { username, premium } = req.body;
    if (!username || premium === undefined) return res.status(400).json({ success: false, message: "Missing fields." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    user.premium = premium;
    await user.save();
    res.status(200).json({ success: true, message: "Premium updated", premium: user.premium });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/user/update-level-passed', async (req, res) => {
  try {
    const { username, difficulty, levelPassed } = req.body;
    if (!username || !difficulty || levelPassed === undefined) return res.status(400).json({ success: false, message: "Missing fields." });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if (difficulty === 'Easy') user.levelPassedEasy = levelPassed;
    else if (difficulty === 'Medium') user.levelPassedMedium = levelPassed;
    else if (difficulty === 'Hard') user.levelPassedHard = levelPassed;
    else return res.status(400).json({ success: false, message: "Invalid difficulty" });
    await user.save();
    res.status(200).json({ success: true, message: "Level passed updated" });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/purchase-history', async (req, res) => {
  try {
    const { username, amount, purchaseType, pack, purchaseMode } = req.body;
    if (!username || !amount || !purchaseType || !pack) return res.status(400).json({ success: false, message: "Missing fields." });
    const safePurchaseMode = purchaseMode === 'Points' ? 'Points' : 'Money';
    
    // Deduplication logic
    const tenSecondsAgo = new Date(Date.now() - 10000);
    const existing = await PurchaseHistory.findOne({
      username, purchaseType, pack, purchaseMode: safePurchaseMode, purchaseDate: { $gte: tenSecondsAgo }
    });
    if (existing) return res.status(200).json({ success: true, message: "Duplicate purchase ignored" });

    const purchaseId = `PURCHASE_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const purchase = new PurchaseHistory({
      username, purchaseId, amount, purchaseType, pack, purchaseMode: safePurchaseMode, purchaseDate: new Date()
    });
    await purchase.save();
    res.status(201).json({ success: true, message: "Purchase recorded" });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.get('/api/purchase-history/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const purchases = await PurchaseHistory.find({ username }).sort({ purchaseDate: -1 });
    res.status(200).json({ success: true, purchases });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.get('/api/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    //const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
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
        levelPassedHard: user.levelPassedHard || 0
      } 
    });
  } catch (error) { res.status(500).json({ success: false, message: "Server error" }); }
});

// --- SERVE STATIC FRONTEND (For Web Version) ---
// Only serve static files if 'dist' directory exists
const distPath = path.join(__dirname, 'dist');
if (existsSync(distPath)) {
  // Serve static files from the 'dist' directory
  app.use(express.static(distPath));

  // Handle React Routing, return all requests to React app
  app.get('*', (req, res) => {
    // If request is not an API call, serve index.html
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
} else {
  // If dist doesn't exist, just handle API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.status(404).json({ message: 'Frontend not built. API server only.' });
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Production Server running on port ${PORT}`);
});