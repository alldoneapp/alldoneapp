# Google OAuth Setup Guide

## Overview

This implementation uses **server-side OAuth** to persist Google Calendar and Gmail connections across devices and browser sessions. Refresh tokens are securely stored in Firestore and managed by Firebase Functions.

## Prerequisites

1. Google Cloud Project with OAuth 2.0 credentials
2. Firebase project (alldonestaging or alldonealeph)
3. Access to Firebase Console and Google Cloud Console

## Step 1: Configure Google Cloud OAuth Credentials

### 1.1 Get OAuth Client Secret

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Find your OAuth 2.0 Client ID (should match `GOOGLE_FIREBASE_WEB_CLIENT_ID`)
5. Click on the client ID to view details
6. Copy the **Client Secret**

### 1.2 Add Authorized Redirect URIs

Add the following redirect URIs to your OAuth 2.0 client:

**For Production (alldonealeph):**

```
https://my.alldone.app/googleOAuthCallback
https://europe-west1-alldonealeph.cloudfunctions.net/googleOAuthCallback
```

**For Staging (alldonestaging):**

```
https://mystaging.alldone.app/googleOAuthCallback
https://europe-west1-alldonestaging.cloudfunctions.net/googleOAuthCallback
```

**For Local Development:**

```
http://localhost:5000/googleOAuthCallback
```

### 1.3 Ensure Required Scopes

Make sure these APIs are enabled in your Google Cloud Project:

-   Google Calendar API
-   Gmail API
-   Google OAuth2 API

## Step 2: Configure Environment Variables

### 2.1 Local Development (.env file)

Edit `/functions/.env` and add:

```bash
GOOGLE_OAUTH_CLIENT_SECRET=your_actual_client_secret_here
```

The `GOOGLE_FIREBASE_WEB_CLIENT_ID` should already be set.

### 2.2 Production/Staging (env_functions.json)

For CI/CD deployment, update `/functions/env_functions.json`:

```json
{
  "GOOGLE_OAUTH_CLIENT_ID": "155167128714-0c45cp04ra5jheqcb1ruq7gar115rc7j.apps.googleusercontent.com",
  "GOOGLE_OAUTH_CLIENT_SECRET": "your_actual_client_secret_here",
  ... other vars ...
}
```

**IMPORTANT:** Never commit the actual client secret to version control!

## Step 3: Deploy Firestore Security Rules

Add these rules to your Firestore security rules:

```javascript
// Google OAuth state verification (temporary, 10 minutes)
match /googleOAuthStates/{stateId} {
  allow read, write: if false; // Only Firebase Functions can access
}

// User private data (includes Google OAuth tokens)
match /users/{userId}/private/{document=**} {
  // Users can read their own private data
  allow read: if request.auth != null && request.auth.uid == userId;
  // Only server can write
  allow write: if false;
}
```

Apply the rules:

1. Go to Firebase Console
2. Select your project
3. Navigate to **Firestore Database** → **Rules**
4. Add the rules above
5. Click **Publish**

## Step 4: Deploy Firebase Functions

### 4.1 Install Dependencies

```bash
cd functions
npm install
```

This will install the `googleapis` package (already added to package.json).

### 4.2 Deploy Functions

**Deploy to development/emulator:**

```bash
firebase emulators:start --only functions
```

**Deploy to staging:**

```bash
firebase deploy --only functions --project alldonestaging
```

**Deploy to production:**

```bash
firebase deploy --only functions --project alldonealeph
```

### 4.3 Verify Deployment

Check that these functions are deployed:

-   `googleOAuthInitiate` (callable)
-   `googleOAuthCallback` (HTTP)
-   `googleOAuthGetToken` (callable)
-   `googleOAuthRevoke` (callable)
-   `googleOAuthCheckCredentials` (callable)

## Step 5: Test the Implementation

### 5.1 Local Testing

1. Start the emulator:

    ```bash
    firebase emulators:start --only functions
    ```

2. In your app, navigate to a project
3. Click **Connect Calendar**
4. You should see an OAuth popup
5. Complete the Google authentication
6. Verify the connection persists after page reload

### 5.2 Cross-Device Testing

1. Connect calendar on Device A
2. Log in on Device B with the same account
3. Verify calendar is already connected on Device B
4. Test that both devices can sync calendar events

## Troubleshooting

### Issue: "Invalid client secret"

-   Verify `GOOGLE_OAUTH_CLIENT_SECRET` is correct in .env or env_functions.json
-   Ensure the client secret matches the OAuth client ID

### Issue: "Redirect URI mismatch"

-   Check that all redirect URIs are added to Google Cloud Console
-   Verify the baseUrl in `getBaseUrl()` matches your environment

### Issue: "User not authenticated with Google"

-   Check Firestore to see if tokens were stored:
    ```
    /users/{userId}/private/googleAuth
    ```
-   Verify Firebase Functions have permission to write to Firestore

### Issue: "Permission denied" when reading tokens

-   Check Firestore security rules are deployed
-   Ensure user is authenticated with Firebase Auth

### Issue: OAuth popup blocked

-   Check browser popup blocker settings
-   Ensure the popup is triggered by user interaction (not async)

## Architecture Diagram

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ 1. Click "Connect"
       ▼
┌─────────────────────────┐
│ startServerSideAuth()   │
│ (calls Cloud Function)  │
└──────┬──────────────────┘
       │ 2. Get auth URL
       ▼
┌─────────────────────────┐
│ Google OAuth Popup      │
│ (User grants access)    │
└──────┬──────────────────┘
       │ 3. Redirect with code
       ▼
┌──────────────────────────────┐
│ googleOAuthCallback          │
│ (Firebase Function/HTTP)     │
└──────┬───────────────────────┘
       │ 4. Exchange code for tokens
       ▼
┌──────────────────────────────┐
│ Firestore:                   │
│ /users/{uid}/private/        │
│   googleAuth                 │
│   ├─ refreshToken (stored)   │
│   ├─ accessToken (cached)    │
│   └─ email, scopes, etc.     │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Client uses calendar         │
│ (auto-refreshes token)       │
└──────────────────────────────┘
```

## Security Considerations

1. **Refresh Token Storage**: Refresh tokens are stored in Firestore with strict security rules
2. **Client Secret**: Never exposed to client - only used in server-side Functions
3. **Access Tokens**: Short-lived, cached on server, auto-refreshed when needed
4. **CSRF Protection**: OAuth state parameter verified in callback
5. **User Isolation**: Each user can only access their own tokens

## Maintenance

### Rotating Client Secret

If you need to rotate the OAuth client secret:

1. Generate new secret in Google Cloud Console
2. Update `.env` and `env_functions.json`
3. Redeploy functions
4. Existing refresh tokens will continue to work
5. New connections will use the new secret

### Monitoring

Monitor these metrics:

-   OAuth callback success rate
-   Token refresh failures
-   Firestore read/write volumes for `googleOAuthStates` and `users/{uid}/private`

### Cleanup

The implementation automatically cleans up:

-   OAuth states expire after 10 minutes
-   Failed OAuth attempts are deleted immediately
-   Revoked tokens are removed from Firestore

## Migration from Client-Side OAuth

The new server-side implementation is backward compatible:

1. Users with existing client-side auth will see "disconnected" after refresh
2. They need to reconnect once using the new flow
3. After reconnecting, it will persist across devices
4. Old client-side tokens are automatically cleaned up

## Support

For issues or questions:

1. Check Firebase Functions logs for errors
2. Verify Firestore security rules are correct
3. Ensure all environment variables are set
4. Check Google Cloud Console OAuth configuration
