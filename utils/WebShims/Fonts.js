// Web replacement for expo-font (migration Stage 1).
// Covers the surface App.js uses: loadAsync({ family: { uri } }). Uses the
// FontFace API (what expo-font's web implementation wraps as well); silently
// no-ops where it is unavailable (jsdom in tests).

export const loadAsync = async fontMap => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
    await Promise.all(
        Object.entries(fontMap).map(([family, source]) => {
            const uri = typeof source === 'string' ? source : source && source.uri
            if (!uri) return Promise.resolve()
            const face = new FontFace(family, `url(${uri})`)
            return face
                .load()
                .then(loaded => document.fonts.add(loaded))
                .catch(() => {})
        })
    )
}
