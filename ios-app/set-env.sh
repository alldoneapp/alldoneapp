#!/bin/sh
# Switches the iOS shell's native config between staging and production:
# the bundled GoogleService-Info.plist AND the matching Google sign-in URL
# scheme (REVERSED_CLIENT_ID) in Info.plist. Both must always agree — a
# mismatched pair breaks native Google sign-in silently.
#
# The WEB bundle is a separate concern: a local `npm run build-web-webpack`
# uses the root .env (staging). A production shell build needs a
# production-env web bundle (the CI `build_web_production` artifact).
set -e
cd "$(dirname "$0")"

ENV="$1"
case "$ENV" in
    staging)
        SCHEME="com.googleusercontent.apps.155167128714-kpc7he8kl25uvocvotnjsgpm8fblr8kg"
        ;;
    production)
        SCHEME="com.googleusercontent.apps.432871424856-9chat3jb95e11snr7cf2f1vnkj2msdmq"
        ;;
    *)
        echo "usage: ./set-env.sh staging|production" >&2
        exit 1
        ;;
esac

cp "firebase/GoogleService-Info.$ENV.plist" ios/App/App/GoogleService-Info.plist

PLIST=ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy \
    -c "Add :CFBundleURLTypes array" \
    -c "Add :CFBundleURLTypes:0 dict" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string $SCHEME" \
    "$PLIST"

echo "iOS shell configured for $ENV"
echo "  plist:      firebase/GoogleService-Info.$ENV.plist -> ios/App/App/GoogleService-Info.plist"
echo "  URL scheme: $SCHEME"
