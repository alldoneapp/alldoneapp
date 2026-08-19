// RevenueCat configuration for Apple In-App Purchases (iOS Capacitor shell).
//
// The API key is RevenueCat's PUBLIC Apple SDK key (starts with "appl_") —
// same publicness class as the Firebase web config, safe to ship in the
// bundle. Purchases are only ever GRANTED server-side by
// functions/Premium/revenueCatWebhook.js, so this key cannot be abused to
// give anyone premium or Gold.
//
// Product ids must stay in sync with App Store Connect, the RevenueCat
// offering, and SUBSCRIPTION_PRODUCTS / GOLD_PRODUCTS in
// functions/Premium/revenueCatWebhook.js.

// TODO: fill in after creating the RevenueCat project (Settings → API keys →
// Apple App Store). Empty string = IAP UI shows its "not configured" state.
export const REVENUECAT_APPLE_API_KEY = ''

export const IAP_PRODUCT_PREMIUM_MONTHLY = 'alldone_premium_monthly'
export const IAP_PRODUCT_PREMIUM_YEARLY = 'alldone_premium_yearly'
export const IAP_PRODUCT_GOLD_10000 = 'alldone_gold_10000'

export const IAP_GOLD_AMOUNT = 10000
