/**
 * Optional counters and supporting lists must not turn a stale/private document into an
 * uncaught Firestore listener error for the whole screen. Keep production quiet and fall back
 * to the empty value the component already uses while retaining a diagnostic in development.
 */
export const handleOptionalSnapshotError = (context, error, applyFallback) => {
    applyFallback()

    if (process.env.NODE_ENV !== 'production') {
        console.warn(`Optional Firestore listener failed (${context}):`, error)
    }
}
