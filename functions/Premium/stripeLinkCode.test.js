'use strict'

// AT-2978 (security decision 6): a Stripe subscription paid under another address is linked with a
// code mailed to that address.

const {
    requestStripeLinkCode,
    consumeStripeLinkCode,
    buildCodeEmail,
    CODE_TTL_MS,
    MAX_ATTEMPTS,
    RESEND_INTERVAL_MS,
    MAX_CODES_PER_HOUR,
} = require('./stripeLinkCode')

function createDb() {
    const docs = new Map()
    const snapshot = p => ({ exists: docs.has(p), data: () => (docs.has(p) ? { ...docs.get(p) } : undefined) })
    const write = (p, data, options) => docs.set(p, options?.merge ? { ...(docs.get(p) || {}), ...data } : { ...data })
    const ref = p => ({ path: p, get: async () => snapshot(p), set: async (data, options) => write(p, data, options) })
    return {
        docs,
        collection: name => ({ doc: id => ref(`${name}/${id}`) }),
        runTransaction: async fn =>
            fn({ get: async r => snapshot(r.path), set: (r, data, options) => write(r.path, data, options) }),
    }
}

const NOW = 1_800_000_000_000
const fixedCode = () => 42

async function sendCode(db, overrides = {}) {
    const sendEmail = jest.fn(async () => {})
    const hasStripeCustomer = jest.fn(async () => true)
    const result = await requestStripeLinkCode({
        db,
        userId: 'u1',
        email: ' Paid@Example.com ',
        language: 'de',
        hasStripeCustomer,
        sendEmail,
        now: NOW,
        randomInt: fixedCode,
        ...overrides,
    })
    return { result, sendEmail, hasStripeCustomer }
}

test('mails a six-digit code and stores only its hash', async () => {
    const db = createDb()
    const { result, sendEmail } = await sendCode(db)

    expect(result).toEqual({ sent: true, expiresAt: NOW + CODE_TTL_MS })
    expect(sendEmail).toHaveBeenCalledWith({
        to: 'paid@example.com',
        subject: 'Dein Alldone-Bestätigungscode',
        html: expect.stringContaining('000042'),
    })
    const stored = db.docs.get('stripeLinkCodes/u1')
    expect(stored).toMatchObject({ email: 'paid@example.com', attempts: 0, expiresAt: NOW + CODE_TTL_MS })
    expect(JSON.stringify(stored)).not.toContain('000042')
})

test('answers the same when Stripe has no such customer, but sends nothing', async () => {
    const db = createDb()
    const { result, sendEmail } = await sendCode(db, { hasStripeCustomer: async () => false })
    expect(result).toEqual({ sent: true, expiresAt: NOW + CODE_TTL_MS })
    expect(sendEmail).not.toHaveBeenCalled()
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '000042', now: NOW })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
})

test('the right code confirms the address once', async () => {
    const db = createDb()
    await sendCode(db)
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '000 042', now: NOW + 1000 })
    ).resolves.toEqual({ ok: true, email: 'paid@example.com' })
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '000042', now: NOW + 2000 })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
})

test('a code is bound to its user and its address', async () => {
    const db = createDb()
    await sendCode(db)
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'other@example.com', code: '000042', now: NOW })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
    await expect(
        consumeStripeLinkCode({ db, userId: 'u2', email: 'paid@example.com', code: '000042', now: NOW })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
})

test('a code expires', async () => {
    const db = createDb()
    await sendCode(db)
    await expect(
        consumeStripeLinkCode({
            db,
            userId: 'u1',
            email: 'paid@example.com',
            code: '000042',
            now: NOW + CODE_TTL_MS + 1,
        })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
})

test(`${MAX_ATTEMPTS} wrong codes spend it`, async () => {
    const db = createDb()
    await sendCode(db)
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
        await expect(
            consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '111111', now: NOW })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    }
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '111111', now: NOW })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
    await expect(
        consumeStripeLinkCode({ db, userId: 'u1', email: 'paid@example.com', code: '000042', now: NOW })
    ).rejects.toMatchObject({ code: 'failed-precondition' })
})

test('requests are rate-limited per user', async () => {
    const db = createDb()
    await sendCode(db)
    await expect(sendCode(db, { now: NOW + RESEND_INTERVAL_MS - 1 })).rejects.toMatchObject({
        code: 'resource-exhausted',
    })
    for (let i = 1; i < MAX_CODES_PER_HOUR; i++) {
        await sendCode(db, { now: NOW + i * RESEND_INTERVAL_MS })
    }
    await expect(sendCode(db, { now: NOW + MAX_CODES_PER_HOUR * RESEND_INTERVAL_MS })).rejects.toMatchObject({
        code: 'resource-exhausted',
    })
})

test('refuses something that is not an address', async () => {
    await expect(sendCode(createDb(), { email: 'not an address' })).rejects.toMatchObject({ code: 'invalid-argument' })
})

test('the mail falls back to English', () => {
    expect(buildCodeEmail('123456', 'fr').subject).toBe('Your Alldone confirmation code')
    expect(buildCodeEmail('123456', 'es').subject).toBe('Tu código de confirmación de Alldone')
})
