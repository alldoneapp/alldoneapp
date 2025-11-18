# Firestore Security Rules for Google OAuth

## Required Security Rules

Add the following security rules to protect the private Google OAuth tokens stored in Firestore:

```javascript
// In your Firestore security rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ... existing rules ...

    // Google OAuth state verification (temporary, 10 minutes)
    match /googleOAuthStates/{stateId} {
      // Only Firebase Functions can read/write
      allow read, write: if false;
    }

    // User private data (includes Google OAuth tokens)
    match /users/{userId}/private/{document=**} {
      // Only the user themselves can read their private data
      // Only Firebase Functions can write (server-side OAuth flow)
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // Only server can write
    }
  }
}
```

## What These Rules Do

1. **googleOAuthStates**: Temporary storage for OAuth state verification

    - Completely protected - only Firebase Functions can access
    - Prevents CSRF attacks during OAuth flow

2. **users/{userId}/private/googleAuth**: Stores refresh tokens and OAuth credentials
    - User can READ their own tokens (needed for client to check connection status)
    - Only server-side Functions can WRITE (ensures security)
    - Prevents token theft or manipulation by client-side code

## How to Apply

1. Go to Firebase Console: https://console.firebase.google.com
2. Select your project (alldonestaging or alldonealeph)
3. Navigate to Firestore Database → Rules
4. Add the rules above to your existing ruleset
5. Publish the rules

## Testing in Emulator

If using Firebase emulators for local development, the rules are in:

-   `firestore.rules` (if it exists in project root)
-   Or can be configured via `firebase.json`
