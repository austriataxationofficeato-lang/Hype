require('dotenv').config();
module.exports = function(){
  const express = require('express');
  const cors = require('cors');
  const session = require('express-session');
  const passport = require('passport');
  const GoogleOAuth2Strategy = require('passport-google-oauth20').Strategy;
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  const {v4: uuidv4} = require('uuid');

  const app = express();
  const PORT = process.env.PORT || 3000;

  const USERS_FILE = path.join(__dirname, 'data', 'users.json');
  const RECORDINGS_FILE = path.join(__dirname, 'data', 'recordings.json');
  const DATA_DIR = path.join(__dirname, 'data');
  if(!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive:true});
  }

  function loadData(filePath, defaultData) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {
      console.log('Starting fresh:', filePath);
    }
    return defaultData;
  }

  function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  const users = loadData(USERS_FILE, {});
  const recordings = loadData(RECORDINGS_FILE, []);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, {recursive:true});
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4}${path.extname(file.originalName)}`;
      cb(null, uniqueName);
    }
  });
  const upload = multer({storage, limits:{fileSize: 50 * 1024 * 1024}});

  app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
  }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'hype-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie:{secure: false}
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = users[id];
    done(null, user);
  });

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleOAuth2Strategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    }, (accessToken, refreshToken, profile, done) => {
      let user = users[profile.id];
      if (!user) {
        user = {
          id: profile.id,
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails?.[0]?.value,
          photo: profile.photos?.[0]?.value,
          recordings: [],
          createdAt: new Date().toISOString()
        };
        users[profile.id] = user;
        saveData(USERS_FILE, users);
      }
      done(null, user);
    }));
  }

  app.get('/auth/google', passport.authenticate('google', {scope: ['profile', 'email']}));

  app.get('/auth/google/callback',
    passport.authenticate('google', {failureRedirect: '/?error=auth'}),
    (req, res) => {
      res.redirect('/');
    });

  app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
      res.json({user: req.user});
    } else {
      res.json({user: null});
    }
  });

  app.post('/api/logout', (req, res) => {
    req.logout(() => {
      res.json({success: true});
    });
  });

  app.get('/api/recordings', (req, res) => {
    const allRecordings = recordings.map(r => ({
      ...r,
      audioUrl: `/uploads/${r.filename}`
    }));
    res.json({recordings: allRecordings});
  });

  app.post('/api/record', upload.single('audio'), (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({error: 'Not authenticated'});
    }

    const recording = {
      id: uuidv4(),
      userId: req.user.id,
      userName: req.user.name,
      userPhoto: req.user.photo,
      filename: req.file.filename,
      title: req.body.title || 'Untitled',
      createdAt: new Date().toISOString()
    };

    recordings.push(recording);
    saveData(RECORDINGS_FILE, recordings);

    req.user.recordings.push(recording.id);
    users[req.user.id] = req.user;
    saveData(USERS_FILE, users);

    res.json({recording: {...recording, audioUrl: `/uploads/${recording.filename}`}});
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Hype server running on port ${PORT}`);
  });
}();