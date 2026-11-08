'use strict'

const {
    LEGACY_WORKER_GRACE_UNTIL_MS,
    evaluateSenderAuthentication,
    isAlignedDomain,
} = require('./emailSenderAuthentication')

const verdict = (dkim = [], spf = null) => ({ version: 1, dkim, spf })

describe('evaluateSenderAuthentication (NV-06)', () => {
    test('accepts a verified DKIM signature aligned with the envelope sender', () => {
        expect(
            evaluateSenderAuthentication({
                fromEmail: 'karsten@mail.example.com',
                senderAuthentication: verdict([
                    { domain: 'attacker.test', result: 'pass' },
                    { domain: 'example.com', result: 'pass' },
                ]),
            })
        ).toMatchObject({ authenticated: true, method: 'dkim', domain: 'example.com' })
    })

    test('refuses a valid signature from an unrelated domain', () => {
        expect(
            evaluateSenderAuthentication({
                fromEmail: 'victim@example.com',
                senderAuthentication: verdict([{ domain: 'attacker.test', result: 'pass' }]),
            })
        ).toMatchObject({ authenticated: false, reason: 'dkim_pass_not_aligned' })
    })

    test('refuses a failed, missing or temporarily unverifiable signature', () => {
        for (const result of ['fail', 'temperror', 'permerror']) {
            expect(
                evaluateSenderAuthentication({
                    fromEmail: 'victim@example.com',
                    senderAuthentication: verdict([{ domain: 'example.com', result }]),
                }).authenticated
            ).toBe(false)
        }
        expect(
            evaluateSenderAuthentication({ fromEmail: 'victim@example.com', senderAuthentication: verdict() })
        ).toMatchObject({ authenticated: false, reason: 'no_dkim_signature' })
    })

    test('accepts a forwarded SPF pass only for exactly the sender domain', () => {
        const pass = domain => verdict([], { result: 'pass', domain })
        expect(
            evaluateSenderAuthentication({ fromEmail: 'a@example.com', senderAuthentication: pass('example.com') })
                .authenticated
        ).toBe(true)
        expect(
            evaluateSenderAuthentication({ fromEmail: 'a@example.com', senderAuthentication: pass('mail.example.com') })
                .authenticated
        ).toBe(false)
        expect(
            evaluateSenderAuthentication({
                fromEmail: 'a@example.com',
                senderAuthentication: verdict([], { result: 'softfail', domain: 'example.com' }),
            }).authenticated
        ).toBe(false)
    })

    test('an unknown verdict version is not trusted', () => {
        expect(
            evaluateSenderAuthentication({
                fromEmail: 'a@example.com',
                senderAuthentication: { version: 2, dkim: [{ domain: 'example.com', result: 'pass' }] },
            }).authenticated
        ).toBe(false)
    })

    test('a payload from the old worker is accepted only until the rollout deadline', () => {
        const payload = { fromEmail: 'a@example.com' }
        expect(evaluateSenderAuthentication(payload, { now: LEGACY_WORKER_GRACE_UNTIL_MS - 1 })).toMatchObject({
            authenticated: true,
            legacy: true,
        })
        expect(evaluateSenderAuthentication(payload, { now: LEGACY_WORKER_GRACE_UNTIL_MS })).toMatchObject({
            authenticated: false,
            reason: 'missing_verdict',
        })
    })

    test('alignment is relaxed but never crosses to an unrelated or bare domain', () => {
        expect(isAlignedDomain('example.com', 'example.com')).toBe(true)
        expect(isAlignedDomain('example.com', 'mail.example.com')).toBe(true)
        expect(isAlignedDomain('mail.example.com', 'example.com')).toBe(true)
        expect(isAlignedDomain('notexample.com', 'example.com')).toBe(false)
        expect(isAlignedDomain('bob.github.io', 'alice.github.io')).toBe(false)
        expect(isAlignedDomain('com', 'example.com')).toBe(false)
    })
})
