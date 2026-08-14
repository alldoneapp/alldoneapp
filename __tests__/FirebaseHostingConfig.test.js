const firebaseConfig = require('../firebase.json')

describe('Firebase Hosting cache policy', () => {
    test('keeps generated static assets immutable after the general no-cache rule', () => {
        const headerRules = firebaseConfig.hosting.headers
        const generalNoCacheRuleIndex = headerRules.findIndex(rule =>
            rule.headers.some(
                header => header.key === 'Cache-Control' && header.value === 'private, no-cache, max-age=0'
            )
        )
        const staticAssetRuleIndex = headerRules.findIndex(rule => rule.source === '/static/**')
        const staticAssetCacheHeader = headerRules[staticAssetRuleIndex].headers.find(
            header => header.key === 'Cache-Control'
        )

        expect(generalNoCacheRuleIndex).toBeGreaterThanOrEqual(0)
        expect(staticAssetRuleIndex).toBeGreaterThan(generalNoCacheRuleIndex)
        expect(staticAssetCacheHeader.value).toBe('public, max-age=31536000, immutable')
    })
})
