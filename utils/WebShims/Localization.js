// Web replacement for expo-localization (migration Stage 1).
// Only the surface the app uses: `locale` (BCP 47 tag like "en-US").
// jsdom provides navigator.language in tests; the fallback covers exotic runtimes.
export const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
