import fs from 'fs'
import path from 'path'

import { resolveOtaDecision, OTA_DECISION, installShellOtaUpdater } from './shellOtaUpdater'

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

describe('installShellOtaUpdater wiring', () => {
    // These two guard the exact pair of failures this file caused on master: a
    // second react-native-dotenv import that the production build cannot resolve,
    // and a private visibilitychange listener that the PT-4660 ratchet forbids.
    // Neither is reproducible from behaviour here — jest gets a generated .env
    // (ci/writeTestEnv.js) that the web build has no equivalent of, so the import
    // resolves fine in this environment and only ever breaks in the bundler.
    const source = fs.readFileSync(path.join(__dirname, 'shellOtaUpdater.js'), 'utf8')

    it('reads the hosting URL through firestore.js, not a second dotenv import', () => {
        // Only the BEGIN-ENVS blocks are env-substituted by ci/replace-envs.sh, so a
        // dotenv import anywhere else fails the production webpack build outright.
        expect(source).not.toMatch(/from\s*'react-native-dotenv'/)
        expect(source).toContain('getHostingUrl')
    })

    it('registers no visibilitychange listener of its own', () => {
        // utils/appResume.js owns the resume signal; AppNavigator passes the
        // returned callback to it as `onResume`.
        expect(source).not.toMatch(/addEventListener\(\s*'visibilitychange'/)
    })

    it('returns a callable no-op outside the Capacitor shell', () => {
        // A browser has no window.Capacitor, so the caller must still get something
        // it can hand to installAppResumeListener without a typeof check.
        const check = installShellOtaUpdater()
        expect(typeof check).toBe('function')
        expect(() => check()).not.toThrow()
    })
})
