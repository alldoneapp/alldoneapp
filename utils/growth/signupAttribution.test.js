import {
    SIGNUP_ATTRIBUTION_STORAGE_KEY,
    buildLandingAttribution,
    captureLandingAttribution,
    clearSignupAttribution,
    getReferrerHost,
    getSignupAttribution,
    hasAttributionSignal,
    sanitizeAttributionLabel,
} from './signupAttribution'

const createStorage = () => {
    const values = new Map()
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        values,
    }
}

describe('signup attribution', () => {
    test('keeps campaign labels, the referring host and the path, never the query or ids', () => {
        const record = buildLandingAttribution({
            href: 'https://my.alldone.app/projects/abc/tasks/open?utm_source=LinkedIn&utm_medium=social&utm_campaign=Segment A&gclid=SECRET123&email=a@b.c',
            referrer: 'https://www.linkedin.com/feed/?trk=xyz',
            now: 1000,
        })

        expect(record).toEqual({
            version: 1,
            utmSource: 'linkedin',
            utmMedium: 'social',
            utmCampaign: 'segment-a',
            utmContent: '',
            utmTerm: '',
            ref: '',
            clickSource: 'google_ads',
            referrerHost: 'linkedin.com',
            landingPath: '/projects/abc/tasks/open',
            capturedAt: 1000,
        })
        expect(JSON.stringify(record)).not.toMatch(/SECRET123|a@b\.c|trk/)
    })

    test('labels lose characters that could carry markup or a map path', () => {
        expect(sanitizeAttributionLabel('  <script>Alert(1)</script> ')).toBe('scriptalert1script')
        expect(sanitizeAttributionLabel('a.b/c$d')).toBe('a.bcd')
        expect(sanitizeAttributionLabel('x'.repeat(200))).toHaveLength(80)
        expect(sanitizeAttributionLabel(42)).toBe('')
    })

    test('the app itself and sign-in providers are not a referrer', () => {
        expect(getReferrerHost('https://accounts.google.com/o/oauth2')).toBe('')
        expect(getReferrerHost('https://my.alldone.app/login')).toBe('')
        expect(getReferrerHost('https://alldonestaging--webpack-x.web.app/')).toBe('')
        expect(getReferrerHost('https://alldone.app/pricing')).toBe('alldone.app')
        expect(getReferrerHost('android-app://com.google.android.gm/')).toBe('')
        expect(getReferrerHost('not a url')).toBe('')
    })

    test('a visit without any signal stores nothing', () => {
        const storage = createStorage()
        expect(captureLandingAttribution({ storage, href: 'https://my.alldone.app/login', referrer: '' })).toBe(null)
        expect(storage.values.size).toBe(0)
    })

    test('the first touch of the tab wins over the return from a redirect sign-in', () => {
        const storage = createStorage()
        captureLandingAttribution({
            storage,
            href: 'https://my.alldone.app/?utm_source=newsletter',
            referrer: '',
            now: 1,
        })
        captureLandingAttribution({
            storage,
            href: 'https://my.alldone.app/?utm_source=other',
            referrer: 'https://news.ycombinator.com/',
            now: 2,
        })

        const attribution = getSignupAttribution({ storage, initialUrl: '/projects/x', now: 5 })
        expect(attribution.utmSource).toBe('newsletter')
        expect(attribution.capturedAt).toBe(1)
        expect(attribution.recordedAt).toBe(5)
    })

    test('a signup without a captured visit records a direct visit to its start path', () => {
        const attribution = getSignupAttribution({
            storage: createStorage(),
            initialUrl: '/projects/tpl/tasks?x=1',
            now: 9,
        })
        expect(hasAttributionSignal(attribution)).toBe(false)
        expect(attribution.landingPath).toBe('/projects/tpl/tasks')
        expect(attribution.recordedAt).toBe(9)
    })

    test('a stored record of another version or garbage is ignored, and clearing removes it', () => {
        const storage = createStorage()
        storage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, '{not json')
        expect(getSignupAttribution({ storage }).utmSource).toBe('')
        storage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify({ version: 99, utmSource: 'x' }))
        expect(getSignupAttribution({ storage }).utmSource).toBe('')

        captureLandingAttribution({ storage: createStorage(), href: 'https://my.alldone.app/?ref=partner' })
        storage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify({ version: 1, ref: 'partner' }))
        clearSignupAttribution(storage)
        expect(storage.values.size).toBe(0)
    })

    test('storage that throws never breaks the app', () => {
        const storage = {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('blocked')
            },
            removeItem: () => {
                throw new Error('blocked')
            },
        }
        expect(() => captureLandingAttribution({ storage, href: 'https://my.alldone.app/?ref=x' })).not.toThrow()
        expect(() => getSignupAttribution({ storage })).not.toThrow()
        expect(() => clearSignupAttribution(storage)).not.toThrow()
    })
})
