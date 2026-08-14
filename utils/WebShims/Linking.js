// Web replacement for expo-linking (migration Stage 1).
// Only the surface the app uses: canOpenURL + openURL. Both call sites already
// prefer window.open on web; openURL is their non-window fallback.
export const canOpenURL = () => Promise.resolve(true)

export const openURL = url => {
    if (typeof window !== 'undefined') {
        window.open(url, '_blank')
    }
    return Promise.resolve()
}
