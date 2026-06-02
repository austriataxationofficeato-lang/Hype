require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleOAuth2Strategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RECORDINGS_FILE = path.join(DATA_DIR, 'recordings.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');

// Create directories
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Load data
function loadData(filePath, defaultData) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) { console.log('Loading fresh:', filePath); }
  return defaultData;
}

function saveData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Data stores
const users = loadData(USERS_FILE, {});
const recordings = loadData(RECORDINGS_FILE, []);
const likes = loadData(LIKES_FILE, {}); // { recordingId: [userId, ...] }

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hype-secret-key',
  resave: false, saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, users[id]));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleOAuth2Strategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    let user = users[profile.id];
    if (!user) {
      user = {
        id: profile.id,
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails?.[0]?.value,
        photo: profile.photos?.[0]?.value,
        bio: '',
        recordings: [],
        likes: [],
        followers: [],
        following: [],
        createdAt: new Date().toISOString()
      };
      users[profile.id] = user;
      saveData(USERS_FILE, users);
    }
    done(null, user);
  }));
}

// Auth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => res.redirect('/'));

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// API routes
app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ user: null });
  const user = { ...req.user };
  delete user.email; // Privacy
  res.json({ user });
});

app.get('/api/user/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const publicUser = {
    id: user.id,
    name: user.name,
    photo: user.photo,
    bio: user.bio,
    recordings: user.recordings,
    followers: user.followers,
    following: user.following,
    createdAt: user.createdAt
  };
  res.json({ user: publicUser });
});

app.put('/api/profile', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const { bio } = req.body;
  users[req.user.id].bio = bio || '';
  saveData(USERS_FILE, users);
  res.json({ success: true, user: users[req.user.id] });
});

app.get('/api/recordings', (req, res) => {
  const allRecordings = recordings
    .map(r => ({
      ...r,
      audioUrl: `/uploads/${r.filename}`,
      likes: likes[r.id]?.length || 0,
      userLiked: req.isAuthenticated() && likes[r.id]?.includes(req.user.id)
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ recordings: allRecordings });
});

app.get('/api/recordings/user/:userId', (req, res) => {
  const userRecordings = recordings
    .filter(r => r.userId === req.params.userId)
    .map(r => ({
      ...r,
      audioUrl: `/uploads/${r.filename}`,
      likes: likes[r.id]?.length || 0
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ recordings: userRecordings });
});

app.post('/api/recordings', upload.single('audio'), (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No audio file' });

  const recording = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    userPhoto: req.user.photo,
    filename: req.file.filename,
    title: req.body.title || 'Untitled',
    description: req.body.description || '',
    plays: 0,
    createdAt: new Date().toISOString()
  };

  recordings.push(recording);
  saveData(RECORDINGS_FILE, recordings);

  users[req.user.id].recordings.push(recording.id);
  saveData(USERS_FILE, users);

  res.json({ recording: { ...recording, audioUrl: `/uploads/${recording.filename}` } });
});

app.post('/api/recordings/:id/like', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const recordingId = req.params.id;
  const userId = req.user.id;

  if (!likes[recordingId]) likes[recordingId] = [];
  
  const idx = likes[recordingId].indexOf(userId);
  if (idx > -1) {
    likes[recordingId].splice(idx, 1); // Unlike
  } else {
    likes[recordingId].push(userId); // Like
  }
  saveData(LIKES_FILE, likes);

  res.json({ likes: likes[recordingId].length, userLiked: idx === -1 });
});

app.post('/api/recordings/:id/play', (req, res) => {
  const recording = recordings.find(r => r.id === req.params.id);
  if (recording) {
    recording.plays = (recording.plays || 0) + 1;
    saveData(RECORDINGS_FILE, recordings);
  }
  res.json({ success: true });
});

app.post('/api/follow/:userId', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.userId;
  const userId = req.user.id;
  
  if (targetId === userId) return res.status(400).json({ error: 'Cannot follow yourself' });
  
  const targetUser = users[targetId];
  const currentUser = users[userId];
  
  if (!targetUser || !currentUser) return res.status(404).json({ error: 'User not found' });

  const idx = currentUser.following.indexOf(targetId);
  if (idx > -1) {
    currentUser.following.splice(idx, 1);
    targetUser.followers.splice(targetUser.followers.indexOf(userId), 1);
  } else {
    currentUser.following.push(targetId);
    targetUser.followers.push(userId);
  }
  
  saveData(USERS_FILE, users);
  res.json({ following: currentUser.following.includes(targetId) });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Object.values(users)
    .map(u => ({
      id: u.id,
      name: u.name,
      photo: u.photo,
      recordings: u.recordings?.length || 0,
      followers: u.followers?.length || 0
    }))
    .sort((a, b) => b.followers - a.followers)
    .slice(0, 20);
  res.json({ leaderboard });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Hype server running on port ${PORT}`);
});
