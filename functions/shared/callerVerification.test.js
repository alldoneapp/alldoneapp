const {
    isFullyAttestedStirVerstat,
    isUnverifiedPhoneCallSession,
    restrictToolsForUnverifiedCaller,
    UNVERIFIED_CALLER_TOOLS,
} = require('./callerVerification')

describe('phone caller verification (NV-35)', () => {
    test('only full STIR/SHAKEN attestation verifies a caller', () => {
        expect(isFullyAttestedStirVerstat('TN-Validation-Passed-A')).toBe(true)
        expect(isFullyAttestedStirVerstat(' TN-Validation-Passed-A ')).toBe(true)
        ;[
            'TN-Validation-Passed-B',
            'TN-Validation-Passed-C',
            'TN-Validation-Failed-A',
            'No-TN-Validation',
            '',
            null,
        ].forEach(value => expect(isFullyAttestedStirVerstat(value)).toBe(false))
    })

    test('a phone session is unverified unless it says otherwise; other channels are not affected', () => {
        expect(isUnverifiedPhoneCallSession({ channel: 'phone_call' })).toBe(true)
        expect(isUnverifiedPhoneCallSession({ channel: 'phone_call', callerVerified: false })).toBe(true)
        expect(isUnverifiedPhoneCallSession({ channel: 'phone_call', callerVerified: true })).toBe(false)
        expect(isUnverifiedPhoneCallSession({ channel: 'whatsapp_call' })).toBe(false)
        expect(isUnverifiedPhoneCallSession({ channel: 'browser_call' })).toBe(false)
    })

    test('the allowlist reads public information only', () => {
        expect(UNVERIFIED_CALLER_TOOLS).toEqual(['web_search'])
        expect(restrictToolsForUnverifiedCaller(['get_tasks', 'web_search', 'search_gmail'])).toEqual(['web_search'])
        expect(restrictToolsForUnverifiedCaller(null)).toEqual([])
    })
})
