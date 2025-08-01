#!/bin/sh
set -e

echo "Starting environment variable replacement..."

# Replace environment variables in firestore.js
echo "const GOOGLE_FIREBASE_WEB_CLIENT_ID = \"$GOOGLE_FIREBASE_WEB_CLIENT_ID_PROD\"" > temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_API_KEY = \"$GOOGLE_FIREBASE_WEB_API_KEY_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_AUTH_DOMAIN = \"$GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_DATABASE_URL = \"$GOOGLE_FIREBASE_WEB_DATABASE_URL_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_PROJECT_ID = \"$GOOGLE_FIREBASE_WEB_PROJECT_ID_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_STORAGE_BUCKET = \"$GOOGLE_FIREBASE_STORAGE_BUCKET_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID = \"$GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_APP_ID = \"$GOOGLE_FIREBASE_WEB_APP_ID_PROD\"" >> temp_firestore_envs.txt
echo "const SENTRY_DSN = \"$SENTRY_DSN\"" >> temp_firestore_envs.txt
echo "const HOSTING_URL = \"$HOSTING_URL_PROD\"" >> temp_firestore_envs.txt
echo "const CURRENT_ENVIORNMENT = \"$CURRENT_ENVIORNMENT_PROD\"" >> temp_firestore_envs.txt
echo "const NOTES_COLLABORATION_SERVER = \"$NOTES_COLLABORATION_SERVER\"" >> temp_firestore_envs.txt
echo "const ALGOLIA_APP_ID = \"$ALGOLIA_APP_ID_PROD\"" >> temp_firestore_envs.txt
echo "const ALGOLIA_SEARCH_ONLY_API_KEY = \"$ALGOLIA_SEARCH_ONLY_API_KEY_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET = \"$GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET_PROD\"" >> temp_firestore_envs.txt
echo "const IP_REGISTRY_API_KEY = \"$IP_REGISTRY_API_KEY\"" >> temp_firestore_envs.txt
echo "const SIB_API_KEY = \"$SIB_API_KEY\"" >> temp_firestore_envs.txt
echo "const SIB_MARKETING_SERVICE_LIST = \"$SIB_MARKETING_SERVICE_LIST_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_ANALYTICS_KEY = \"$GOOGLE_ANALYTICS_KEY_PROD\"" >> temp_firestore_envs.txt
echo "const GOOGLE_ADS_GUIDE_CONVERSION_TAG = \"$GOOGLE_ADS_GUIDE_CONVERSION_TAG_PROD\"" >> temp_firestore_envs.txt
echo "const GIPHY_API_KEY = \"$GIPHY_API_KEY_PROD\"" >> temp_firestore_envs.txt
echo "const PERPLEXITY_API_KEY = \"$PERPLEXITY_API_KEY_PROD\"" >> temp_firestore_envs.txt

sed -i '/BEGIN-ENVS/,/END-ENVS/d' utils/backends/firestore.js
sed -i '/\/\/ BEGIN-ENVS/r temp_firestore_envs.txt' utils/backends/firestore.js

# Replace environment variables in apisConfig.js
echo "const GOOGLE_FIREBASE_WEB_CLIENT_ID = \"$GOOGLE_FIREBASE_WEB_CLIENT_ID_PROD\"" > temp_apis_envs.txt
echo "const GOOGLE_FIREBASE_WEB_API_KEY = \"$GOOGLE_FIREBASE_WEB_API_KEY_PROD\"" >> temp_apis_envs.txt

sed -i '/BEGIN-ENVS/,/END-ENVS/d' apis/google/apisConfig.js
sed -i '/\/\/ BEGIN-ENVS/r temp_apis_envs.txt' apis/google/apisConfig.js

# Replace placeholders in firebase-messaging-sw.js
sed -i "s|__FIREBASE_API_KEY__|${GOOGLE_FIREBASE_WEB_API_KEY_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_AUTH_DOMAIN__|${GOOGLE_FIREBASE_WEB_AUTH_DOMAIN_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_DATABASE_URL__|${GOOGLE_FIREBASE_WEB_DATABASE_URL_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_PROJECT_ID__|${GOOGLE_FIREBASE_WEB_PROJECT_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_STORAGE_BUCKET__|${GOOGLE_FIREBASE_STORAGE_BUCKET_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${GOOGLE_FIREBASE_WEB_MESSAGING_SENDER_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_APP_ID__|${GOOGLE_FIREBASE_WEB_APP_ID_PROD}|g" web/firebase-messaging-sw.js
sed -i "s|__FIREBASE_MEASUREMENT_ID__|${GOOGLE_ANALYTICS_KEY_PROD}|g" web/firebase-messaging-sw.js

echo "Environment variable replacement completed"