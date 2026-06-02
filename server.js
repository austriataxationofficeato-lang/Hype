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
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// JSON file helpers
function loadJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.log('Loading fresh:', file); }
  return null;
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Database files
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RECORDINGS_FILE = path.join(DATA_DIR, 'recordings.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');

// Initialize databases
let users = loadJSON(USERS_FILE) || {};
let recordings = loadJSON(RECORDINGS_FILE) || [];
let likes = loadJSON(LIKES_FILE) || {}; // { recordingId: [userId1, userId2...] }

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

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

// Passport config
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
        followers: [],
        following: [],
        recordings: [],
        createdAt: new Date().toISOString()
      };
      users[profile.id] = user;
      saveJSON(USERS_FILE, users);
    }
    done(null, user);
  }));
}

// Auth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => res.redirect('/'));

// API routes

// Get current user
app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    const u = users[req.user.id];
    res.json({ user: { ...u, recordings: undefined } });
  } else {
    res.json({ user: null });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.logout(() => res.json({ success: true }));
});

// Get all recordings (feed)
app.get('/api/recordings', (req, res) => {
  const feed = recordings.map(r => {
    const user = users[r.userId];
    const recordingLikes = likes[r.id] || [];
    return {
      ...r,
      audioUrl: `/uploads/${r.filename}`,
      userName: user?.name || 'Unknown',
      userPhoto: user?.photo || '',
      likes: recordingLikes.length,
      liked: req.isAuthenticated() ? recordingLikes.includes(req.user.id) : false
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ recordings: feed });
});

// Get single recording
app.get('/api/recordings/:id', (req, res) => {
  const r = recordings.find(rec => rec.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const user = users[r.userId];
  const recordingLikes = likes[r.id] || [];
  res.json({
    recording: {
      ...r,
      audioUrl: `/uploads/${r.filename}`,
      userName: user?.name || 'Unknown',
      userPhoto: user?.photo || '',
      likes: recordingLikes.length,
      liked: req.isAuthenticated() ? recordingLikes.includes(req.user.id) : false
    }
  });
});

// Upload recording
app.post('/api/record', upload.single('audio'), (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file' });
  }

  const recording = {
    id: uuidv4(),
    userId: req.user.id,
    filename: req.file.filename,
    title: req.body.title || 'Untitled Track',
    description: req.body.description || '',
    genre: req.body.genre || 'Hip Hop',
    plays: 0,
    createdAt: new Date().toISOString()
  };

  recordings.push(recording);
  saveJSON(RECORDINGS_FILE, recordings);

  users[req.user.id].recordings.push(recording.id);
  saveJSON(USERS_FILE, users);

  res.json({ recording: { ...recording, audioUrl: `/uploads/${recording.filename}` } });
});

// Like/unlike recording
app.post('/api/recordings/:id/like', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const r = recordings.find(rec => rec.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });

  if (!likes[r.id]) likes[r.id] = [];
  const userLikes = likes[r.id];
  const idx = userLikes.indexOf(req.user.id);

  if (idx > -1) {
    userLikes.splice(idx, 1);
  } else {
    userLikes.push(req.user.id);
  }
  likes[r.id] = userLikes;
  saveJSON(LIKES_FILE, likes);

  res.json({ likes: userLikes.length, liked: idx === -1 });
});

// Get user profile
app.get('/api/users/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const userRecordings = recordings
    .filter(r => r.userId === user.id)
    .map(r => {
      const recordingLikes = likes[r.id] || [];
      return {
        ...r,
        audioUrl: `/uploads/${r.filename}`,
        likes: recordingLikes.length
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    profile: {
      id: user.id,
      name: user.name,
      photo: user.photo,
      bio: user.bio,
      followers: user.followers?.length || 0,
      following: user.following?.length || 0,
      recordingsCount: userRecordings.length,
      createdAt: user.createdAt
    },
    recordings: userRecordings
  });
});

// Update user profile
app.put('/api/user/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { bio, name } = req.body;
  if (bio !== undefined) users[req.user.id].bio = bio;
  if (name !== undefined) users[req.user.id].name = name;
  saveJSON(USERS_FILE, users);

  res.json({ success: true, user: users[req.user.id] });
});

// Follow/unfollow user
app.post('/api/users/:id/follow', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  const targetUser = users[req.params.id];
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const currentUser = users[req.user.id];
  if (!currentUser.following) currentUser.following = [];
  if (!targetUser.followers) targetUser.followers = [];

  const idx = currentUser.following.indexOf(req.params.id);
  if (idx > -1) {
    currentUser.following.splice(idx, 1);
    targetUser.followers = targetUser.followers.filter(f => f !== req.user.id);
  } else {
    currentUser.following.push(req.params.id);
    targetUser.followers.push(req.user.id);
  }

  saveJSON(USERS_FILE, users);
  res.json({ success: true, following: currentUser.following.includes(req.params.id) });
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Object.values(users)
    .map(u => ({
      id: u.id,
      name: u.name,
      photo: u.photo,
      recordingsCount: u.recordings?.length || 0,
      followersCount: u.followers?.length || 0
    }))
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, 50);
  res.json({ leaderboard });
});

// Increment play count
app.post('/api/recordings/:id/play', (req, res) => {
  const r = recordings.find(rec => rec.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  r.plays = (r.plays || 0) + 1;
  saveJSON(RECORDINGS_FILE, recordings);
  res.json({ success: true });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Hype server running on port ${PORT}`);
});