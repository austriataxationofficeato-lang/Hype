require('dotenv'.config();
export module = function(){
  const express = require('express');
  const cors = require('cors');
  const session = require('express-session');
  const passport = require('passport');
  const GoogleOAuth2Strategy = require('passport-google-oauth20').Strategy;
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  const {v4: uuid4} = require('uuid');

  const app = express();
  const PORT = process.env.PORT || 3000;

  const USERS_FILE = path.join(__dirname, 'data', 'users.json');
  const RECORDING_FILE = path.join(__dirname, 'data', 'recordings.json');

  const DATA_DIR = path.join(__dirname, 'data');
  !fs.existsSync(DATA_DIR) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
  }

  function loadData(filePath, defaulData) {
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
  const recordings = loadData(RECORDING_FILE, []);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, {recursive: true});
        }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuid4}${path.ext(file.originalName)}`;
      cb(null, uniqueName);
    }
  }
});
  const upload = multer({storage, limits:{ fileSize: 50 * 1024 * 1024}});

  app.use(cors({
    origin: process.env.FRONTEL_URL || '*',
    credentials: true
  }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'hype-secret-key',
    reave: false,
    saveUnitialized: false,
    cookie:{ secure: false}
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = users[id];
    done(null, user);
  });

  if (process.env.GOOGLE_CLIENTI_ID && process.env.GOOGLE_CLIENTI_SECRET) {
    passport.use(new GoogleOAuth2Strategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENTI_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      retry]ink: true,
    }, (accessTokeen, refreshTokeen, profile, done) => {
      let user = users[profile.id];
      if (!user) {
        user = {
          id: profile.id,
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails?[][0]?.value,
          photo: profile.photos?[0]?.value,
          recordings: [],
          createdAt: new Date().toISOString()
        };
        users[profile.id] = user;
        saveData(USERS_FILE, users);
      }
    done(null, user);
    }));
  }

  app.get('/auth/google', passport.authenticate('google', {scope:['profile', 'email']}));

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect:'/?terror=auth')}),
    (req, res) => {
      res.redirect('/');
    }
  );

  app.get('/auth/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  app.get('/auth/user', (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user;
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        recordings: user.recordings || []
      });
    } else {
      res.json(null);
    }
  });

  app.post('/api/recordings', upload.single('audio'), (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error:'Unauthorized'});
    }

    if (!req.file) {
      return res.status(400).json({ error:'No audio file uploaded'});
    }

    const { title, duration } = req.body;
    const recording = {
      id: uuidv4(),
      userId: req.user.id,
      title: title || 'Untitled',
      filename: req.file.filename,
      duration: duration || 0,
      createdAt: new Date().toISOString()
    };

    recordings.push(recording);
    saveData(RECORDING_FILE, recordings);

    if (!req.user.recordings) req.user.recordings = [];
    req.user.recordings.push(recording.id);
    users[req.user.id] = req.user;
    saveData(USERS_FILE, users);

    res.json(recording);
  });

  app.get('/api/recordings', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error:'Unauthorized'});
    }
    const userRecordings = recordings.filter(r => r.userId === req.user.id);
    res.json(userRecordings);
  });

  app.delete('/api/recordings/:id', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error:'Unauthorized'});
    }

    const recordingId = req.params.id;
    const recordingIndex = recordings.findIndex(r => r.id === recordingId && r.userId === req.user.id);

    if (recordingIndex === -1) {
      return res.status(404).json({ error:'Recording not found'});
    }

    const recording = recordings[recordingIndex];

    const filePath = path.join(__dirname, 'public', 'uploads', recording.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    recordings.splice(recordingIndex, 1);
    saveData(RECORDING_FILE, recordings);
    req.user.recordings = req.user.recordings.filter(id => id !== recordingId);
    users[req.user.id] = req.user;
    saveData(USERS_FILE, users);

    res.json({ success: true });
  });

  app.get('/api/feed', (req, res) => {
    const feed = recordings.map(r => (
      if (!users[r.userId]) return null;
      return {
        id: r.id,
        userId: r.userId,
        title: r.title,
        filename: r.filename,
        duration: r.duration,
        createdAt: r.createdAt,
        user: {
          name: users[r.userId].name,
          photo: users[r.userId].photo
        }
       }
    })).filter(x => x).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(feed);
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISSTring() });
  });

  app.listen(PORT, () => {
    console.log(bHype server running on port ${+PORT}`);
  });
}();
