jest.mock('react-native-dotenv', () => ({ HOSTING_URL: 'https://mystaging.alldone.app' }), { virtual: true })

import { resolveOtaDecision, OTA_DECISION } from './shellOtaUpdater'

const CI_CURRENT = { version: 'aaa111', channel: 'ci' }

describe('resolveOtaDecision', () => {
    it('applies when the deployed version differs', () => {
        expect(
            resolveOtaDecision(CI_CURRENT, { version: 'bbb222', channel: 'ci', url: '/ota/bundle-bbb222.zip' })
        ).toBe(OTA_DECISION.APPLY)
    })

    it('does nothing when already on the deployed version', () => {
        expect(
            resolveOtaDecision(CI_CURRENT, { version: 'aaa111', channel: 'ci', url: '/ota/bundle-aaa111.zip' })
        ).toBe(OTA_DECISION.UP_TO_DATE)
    })

    it('never updates FROM a local dev build', () => {
        expect(
            resolveOtaDecision(
                { version: 'dev', channel: 'local' },
                { version: 'bbb', channel: 'ci', url: '/ota/b.zip' }
            )
        ).toBe(OTA_DECISION.LOCAL_BUILD)
        expect(resolveOtaDecision(null, { version: 'bbb', channel: 'ci', url: '/ota/b.zip' })).toBe(
            OTA_DECISION.LOCAL_BUILD
        )
    })

    it('never updates TO a non-ci or malformed manifest', () => {
        expect(resolveOtaDecision(CI_CURRENT, { version: 'bbb', channel: 'local', url: '/ota/b.zip' })).toBe(
            OTA_DECISION.BAD_MANIFEST
        )
        expect(resolveOtaDecision(CI_CURRENT, null)).toBe(OTA_DECISION.BAD_MANIFEST)
        expect(
            resolveOtaDecision(CI_CURRENT, { version: 'bbb', channel: 'ci', url: 'https://evil.example/x.zip' })
        ).toBe(OTA_DECISION.BAD_MANIFEST)
        expect(resolveOtaDecision(CI_CURRENT, { version: '', channel: 'ci', url: '/ota/b.zip' })).toBe(
            OTA_DECISION.BAD_MANIFEST
        )
    })
})
