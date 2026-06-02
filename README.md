# Hype - Music Recording App

Similar to Rap Fame, a music recording app with Google authentication.

---

Environment Variables

Create a new `.env` file from `.env.example`:


```

# Google OAuth Credentials
 Create a project at https://console.developers.google.com/

GOOGLE_CLIENT_ID = your-google-client-id
GOOGLE_CLIENT_SECRET = your-google-client-secret
GOOGLE_CALLBACK_URL = https://your-backend-url/auth/google/callback
SESSION_SECRET = random-secret-key-hereTEMPORAR_URL = https://your-frontend-vercel.app
```

# Running Locally

````shell
9arn install
node server.js
````

---

API Endpoints

- get /auth/google - Begin Google login
/ get /auth/user - Get current user status
/ get /auth/logout - Logout
- post /api/recording - Upload recording (audio file) - Authenticated
/get /api/recordings - List user's recordings - Authenticated
- delete /api/recordings/:id - Delete recording - Authenticated
/get /api/feed - Public feed of all recordings
