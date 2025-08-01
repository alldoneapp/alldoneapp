#!/bin/sh
set -e

echo "Starting environment variable replacement..."
echo "Current working directory: $(pwd)"
echo "Checking if files exist before replacement:"
ls -la utils/backends/firestore.js apis/google/apisConfig.js web/firebase-messaging-sw.js || true

# Replace environment variables in firestore.js (use const for local scope)
cat > temp_firestore_envs.txt << EOF
const GOOGLE_FIREBASE_WEB_CLIENT_ID = "$GOOGLE_FIREBASE_WEB_CLIENT_ID_PROD"
const GOOGLE_FIREBASE_WEB_API_KEY = "$GOOGLE_FIREBASE_WEB_API_KEY_PROD"
const GOOGLE_FIREBASE_WEB_AUTH_DOMAIN = "$GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_PROD"
const GOOGLE_FIREBASE_WEB_DATABASE_URL = "$GOOGLE_FIREBASE_WEB_DATABASE_URL_PROD"
const GOOGLE_FIREBASE_WEB_PROJECT_ID = "$GOOGLE_FIREBASE_WEB_PROJECT_ID_PROD"
const GOOGLE_FIREBASE_STORAGE_BUCKET = "$GOOGLE_FIREBASE_STORAGE_BUCKET_PROD"
const GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID = "$GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_PROD"
const GOOGLE_FIREBASE_WEB_APP_ID = "$GOOGLE_FIREBASE_WEB_APP_ID_PROD"
const SENTRY_DSN = "$SENTRY_DSN"
const HOSTING_URL = "$HOSTING_URL_PROD"
const CURRENT_ENVIORNMENT = "$CURRENT_ENVIORNMENT_PROD"
const NOTES_COLLABORATION_SERVER = "$NOTES_COLLABORATION_SERVER"
const ALGOLIA_APP_ID = "$ALGOLIA_APP_ID_PROD"
const ALGOLIA_SEARCH_ONLY_API_KEY = "$ALGOLIA_SEARCH_ONLY_API_KEY_PROD"
const GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET = "$GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET_PROD"
const IP_REGISTRY_API_KEY = "$IP_REGISTRY_API_KEY"
const SIB_API_KEY = "$SIB_API_KEY"
const SIB_MARKETING_SERVICE_LIST = "$SIB_MARKETING_SERVICE_LIST_PROD"
const GOOGLE_ANALYTICS_KEY = "$GOOGLE_ANALYTICS_KEY_PROD"
const GOOGLE_ADS_GUIDE_CONVERSION_TAG = "$GOOGLE_ADS_GUIDE_CONVERSION_TAG_PROD"
const GIPHY_API_KEY = "$GIPHY_API_KEY_PROD"
const PERPLEXITY_API_KEY = "$PERPLEXITY_API_KEY_PROD"
EOF

echo "Before replacement - checking firestore.js:"
grep -A 5 -B 5 "BEGIN-ENVS" utils/backends/firestore.js || true
# First add our constants after the BEGIN-ENVS line
sed -i '/\/\/ BEGIN-ENVS/r temp_firestore_envs.txt' utils/backends/firestore.js
# Then delete the original import block (everything between import { and } from 'react-native-dotenv')
sed -i "/import {/,/} from 'react-native-dotenv'/d" utils/backends/firestore.js
echo "After replacement - checking firestore.js:"
grep -A 10 -B 5 "NOTES_COLLABORATION_SERVER" utils/backends/firestore.js || true

# Replace environment variables in apisConfig.js (use const for local scope)
cat > temp_apis_envs.txt << EOF
const GOOGLE_FIREBASE_WEB_CLIENT_ID = "$GOOGLE_FIREBASE_WEB_CLIENT_ID_PROD"
const GOOGLE_FIREBASE_WEB_API_KEY = "$GOOGLE_FIREBASE_WEB_API_KEY_PROD"
EOF

# First add our constants after the BEGIN-ENVS line  
sed -i '/\/\/ BEGIN-ENVS/r temp_apis_envs.txt' apis/google/apisConfig.js
# Then delete the original import line
sed -i "/import.*'react-native-dotenv'/d" apis/google/apisConfig.js

# Replace placeholders in firebase-messaging-sw.js
sed -i "s|__FIREBASE_API_KEY__|${GOOGLE_FIREBASE_WEB_API_KEY_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_AUTH_DOMAIN__|${GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_DATABASE_URL__|${GOOGLE_FIREBASE_WEB_DATABASE_URL_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_PROJECT_ID__|${GOOGLE_FIREBASE_WEB_PROJECT_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_STORAGE_BUCKET__|${GOOGLE_FIREBASE_STORAGE_BUCKET_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_APP_ID__|${GOOGLE_FIREBASE_WEB_APP_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_MEASUREMENT_ID__|${GOOGLE_ANALYTICS_KEY_PROD}|g" web/firebase-messaging-sw.js

echo "Checking final replacement result:"
echo "NOTES_COLLABORATION_SERVER value should be: $NOTES_COLLABORATION_SERVER"
grep -n "NOTES_COLLABORATION_SERVER" utils/backends/firestore.js || true
echo "Environment variable replacement completed"