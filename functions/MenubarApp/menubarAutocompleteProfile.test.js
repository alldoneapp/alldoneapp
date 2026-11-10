'use strict'

// The Mac app's on-device autocomplete puts this profile on a "Writer:" line in front of whatever
// the user types in any app. It must be facts only, short, free of contact details, credentials
// and money matters, and built without a model call or a Gold charge.

const mockDocs = new Map()
const mockDeductGold = jest.fn()
const mockReduceGold = jest.fn()
const mockInteract = jest.fn()

jest.mock('firebase-admin', () => {
    const snapshot = path => ({
        id: path.split('/').at(-1),
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
    })
    const doc = path => ({
        id: path.split('/').at(-1),
        get: async () => snapshot(path),
        set: async data => mockDocs.set(path, { ...(mockDocs.get(path) || {}), ...data }),
    })
    return {
        firestore: () => ({
            doc,
            collection: name => ({ doc: id => doc(`${name}/${id}`) }),
        }),
    }
})
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: () => ({}) }))
jest.mock('../Gold/goldHelper', () => ({ deductGold: mockDeductGold, refundGold: jest.fn() }))
jest.mock('../Assistant/assistantHelper', () => ({
    reduceGoldWhenChatWithAI: mockReduceGold,
    interactWithChatStream: mockInteract,
}))

const crypto = require('crypto')
const { handleMenubarAutocompleteProfile } = require('./menubarApp')
const {
    AUTOCOMPLETE_PROFILE_MAX_CHARS,
    buildAutocompleteProfile,
    __private__,
} = require('./menubarAutocompleteProfile')

const USER_ID = 'user-karsten'
const PROJECT_ID = 'project-alldone'
let tokenCounter = 0

const response = () => {
    const res = { statusCode: 200, body: null }
    res.set = () => res
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.json = body => {
        res.body = body
        return res
    }
    return res
}

// Each test gets its own token and IP so the per-instance rate limiter never trips.
const issueToken = (overrides = {}) => {
    tokenCounter += 1
    const token = `adapp_${String(tokenCounter).padStart(64, 'a')}`
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    mockDocs.set(`menubarAppTokens/${hash}`, {
        userId: USER_ID,
        lastUsedAt: { toMillis: () => Date.now() },
        ...overrides,
    })
    return token
}

const call = async body => {
    const res = response()
    await handleMenubarAutocompleteProfile(
        { method: 'POST', body, headers: { 'x-forwarded-for': `10.0.0.${tokenCounter}` } },
        res
    )
    return res
}

beforeEach(() => {
    mockDocs.clear()
    jest.clearAllMocks()
    mockDocs.set(`users/${USER_ID}`, {
        displayName: 'Karsten Wysk',
        email: 'karsten@alldone.app',
        phone: '+49 170 1234567',
        gold: 900,
        language: 'de',
        role: 'Founder',
        company: 'Alldone',
        defaultProjectId: PROJECT_ID,
        extendedDescription: 'Works with Anna Berger and Tom Kühn on the Mac app. Lives in Berlin.',
    })
    mockDocs.set(`projects/${PROJECT_ID}`, {
        name: 'Alldone',
        userIds: [USER_ID],
        usersData: { [USER_ID]: { role: 'CEO' } },
    })
    mockDocs.set(`assistantMemories/${USER_ID}__${PROJECT_ID}`, {
        content: '2026-10-01: [personal context] Main customer is Bäckerei Schmidt in Potsdam (useful for emails)\n',
    })
})

describe('POST /api/menubar/autocomplete-profile', () => {
    test('rejects a missing, malformed, unknown or revoked token like the other menubar endpoints', async () => {
        expect((await call({})).statusCode).toBe(401)
        expect((await call({ token: 'not-a-token' })).statusCode).toBe(401)
        expect((await call({ token: `adapp_${'z'.repeat(64)}` })).body).toEqual({
            success: false,
            error: 'Invalid token',
        })
        const revoked = issueToken({ revoked: true })
        expect((await call({ token: revoked })).statusCode).toBe(401)
    })

    test('rejects anything but POST', async () => {
        const res = response()
        await handleMenubarAutocompleteProfile({ method: 'GET', body: {}, headers: {} }, res)
        expect(res.statusCode).toBe(405)
    })

    test('returns the profile assembled from user, default project and memory', async () => {
        const res = await call({ token: issueToken() })
        expect(res.statusCode).toBe(200)
        expect(res.body).toEqual({
            success: true,
            profile:
                'Karsten Wysk, CEO at Alldone. Works with Anna Berger and Tom Kühn on the Mac app. ' +
                'Lives in Berlin. Main customer is Bäckerei Schmidt in Potsdam.',
        })
    })

    test('never calls a model or touches Gold', async () => {
        await call({ token: issueToken() })
        expect(mockInteract).not.toHaveBeenCalled()
        expect(mockReduceGold).not.toHaveBeenCalled()
        expect(mockDeductGold).not.toHaveBeenCalled()
        expect(mockDocs.get(`users/${USER_ID}`).gold).toBe(900)
    })

    test('never includes the account email, phone or token', async () => {
        const token = issueToken()
        const { profile } = (await call({ token })).body
        expect(profile).not.toContain('karsten@alldone.app')
        expect(profile).not.toContain('1234567')
        expect(profile).not.toContain(token)
        expect(profile).not.toContain('900')
        // The app language says nothing about what is typed; many users switch all the time.
        expect(profile).not.toMatch(/writes in|german/i)
    })

    test('ignores the default project and its memory once the user has left it', async () => {
        mockDocs.set(`projects/${PROJECT_ID}`, { name: 'Alldone', userIds: ['someone-else'], usersData: {} })
        const { profile } = (await call({ token: issueToken() })).body
        expect(profile).toContain('Founder at Alldone')
        expect(profile).not.toContain('Bäckerei Schmidt')
    })

    test('returns just the name when nothing else is known', async () => {
        mockDocs.set(`users/${USER_ID}`, { displayName: 'Karsten Wysk' })
        expect((await call({ token: issueToken() })).body).toEqual({ success: true, profile: 'Karsten Wysk' })
    })
})

describe('buildAutocompleteProfile', () => {
    test('caps the text under the Mac app limit as one plain paragraph of whole sentences', () => {
        const description = Array.from(
            { length: 40 },
            (_, index) => `## Fact ${index}\n- **Colleague** number ${index} is called Person${index}.`
        ).join('\n')
        const memoryContent = Array.from(
            { length: 40 },
            (_, index) =>
                `2026-10-${String((index % 28) + 1).padStart(2, '0')}: [people] Customer ${index} is Firma${index}`
        ).join('\n')
        const profile = buildAutocompleteProfile({
            userData: { displayName: 'Karsten Wysk', language: 'en', extendedDescription: description },
            memoryContent,
        })
        expect(profile.length).toBeLessThanOrEqual(AUTOCOMPLETE_PROFILE_MAX_CHARS)
        expect(profile.length).toBeGreaterThan(AUTOCOMPLETE_PROFILE_MAX_CHARS - 80)
        expect(profile).not.toMatch(/[\n#*]/)
        expect(profile).toMatch(/\.$/)
        // The description leads, and the newest memory facts still get a share of the budget.
        // Heading lines carry no fact and are dropped.
        expect(profile).not.toContain('Fact 0')
        expect(profile.startsWith('Karsten Wysk. Colleague number 0 is called Person0.')).toBe(true)
        expect(profile).toContain('Customer 39 is Firma39.')
    })

    test('drops sentences with contact details, links, credentials or money, keeps the rest', () => {
        const profile = buildAutocompleteProfile({
            userData: {
                displayName: 'Karsten Wysk',
                extendedDescription: [
                    'Reach me at karsten@example.com.',
                    'My mobile is 0170 1234567.',
                    'Office line +49 30 123456.',
                    'Portfolio at https://example.com/me.',
                    'My IBAN is DE89 3704 0044 0532 0130 00.',
                    'Card 4111 1111 1111 1111.',
                    'Salary is 90k.',
                    'The wifi password is hunter2.',
                    'Api key sk-proj-abcdef.',
                    'Monthly budget is 5.000 €.',
                    'Home is Torstraße 12.',
                    'Works with Lena Vogt in Hamburg.',
                ].join(' '),
            },
            memoryContent:
                '2026-10-01: Uses token adapp_abcdefghijklmnopqrstuvwxyz0123456789\n2026-10-02: Plays tennis on Mondays',
        })
        expect(profile).toBe('Karsten Wysk. Works with Lena Vogt in Hamburg. Plays tennis on Mondays.')
    })

    test('keeps dates that are not phone numbers', () => {
        expect(__private__.isSensitive('Started at Alldone on 2026-11-10.')).toBe(false)
        expect(__private__.isSensitive('Call 030 1234 5678.')).toBe(true)
    })

    test('takes the project role and company over the global ones and dedupes repeated facts', () => {
        const profile = buildAutocompleteProfile({
            userData: { displayName: 'Ana', role: 'Dev', company: 'Old Co', description: 'Lives in Madrid.' },
            projectUserData: { role: 'CTO', company: 'Alldone', description: 'Lives in Madrid.' },
            memoryContent: '2026-10-01: lives in madrid',
        })
        expect(profile).toBe('Ana, CTO at Alldone. Lives in Madrid.')
    })

    test('returns an empty string without a name, and just the name otherwise', () => {
        expect(buildAutocompleteProfile({ userData: {} })).toBe('')
        expect(buildAutocompleteProfile({ userData: { displayName: 'Karsten Wysk' } })).toBe('Karsten Wysk')
        expect(buildAutocompleteProfile({ userData: { displayName: 'Karsten', email: 'k@example.com' } })).toBe(
            'Karsten'
        )
    })
})
