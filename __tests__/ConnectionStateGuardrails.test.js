/** @jest-environment jsdom */

// PT-4660 ratchets. The connection-health feature only works if two things stay
// true, and both decay the same way — by a future change quietly adding "just one
// more" of something. These checks are static and cheap so the copy-paste
// regression fails the build instead of shipping.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const collectJsFiles = dir => {
    const out = []
    if (!fs.existsSync(dir)) return out
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'browser-tests') continue
            out.push(...collectJsFiles(full))
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            out.push(full)
        }
    }
    return out
}

const read = file => fs.readFileSync(file, 'utf8')

const sourceFiles = () => [
    ...collectJsFiles(path.join(ROOT, 'components')),
    ...collectJsFiles(path.join(ROOT, 'utils')),
    ...collectJsFiles(path.join(ROOT, 'hooks')),
]

describe('PT-4660: resume signals have ONE owner', () => {
    // Every one of these fires more than once per resume and in different
    // combinations per browser, which is exactly why utils/appResume.js coalesces
    // them. A component that adds its own listener re-derives that logic wrongly
    // (the usual bug: reacting three times, or missing the bfcache restore that is
    // the ONLY signal an iOS home-screen PWA sends).
    //
    // These four pre-date the module and are deliberately left alone; the counter
    // may only go DOWN. DailyAppReload in particular owns the local-day rollover
    // reload and must not be merged in here — appResume would race it.
    const KNOWN_VISIBILITY_LISTENERS = [
        'components/ChatsView/unreadEmailArchiveContext.js',
        'components/UIComponents/AssistantVoiceCallButton.js',
        'utils/DailyAppReload.js',
        'utils/HelperFunctions.js',
    ]

    it('no new visibilitychange listener outside utils/appResume.js', () => {
        const owners = sourceFiles()
            .filter(file => /addEventListener\(\s*'visibilitychange'/.test(read(file)))
            .map(file => path.relative(ROOT, file))
            .filter(file => file !== 'utils/appResume.js')
            .sort()

        // Only ever shrink this list.
        expect(owners).toEqual(expect.arrayContaining([]))
        owners.forEach(owner => expect(KNOWN_VISIBILITY_LISTENERS).toContain(owner))
        expect(owners.length).toBeLessThanOrEqual(KNOWN_VISIBILITY_LISTENERS.length)
    })

    it('appResume is the module that declares the resume signals', () => {
        const source = read(path.join(ROOT, 'utils/appResume.js'))
        expect(source).toContain("type: 'visibilitychange'")
        expect(source).toContain("type: 'resume'")
        expect(source).toContain("type: 'pageshow'")
        expect(source).toContain("type: 'focus'")
    })
})

describe('PT-4660: every Firestore transport restart goes through the shared lease', () => {
    // A restart is disableNetwork() → enableNetwork(). Three modules do it, and the
    // SDK queues those calls in call order — so an interleaved pair can leave the
    // network parked for the whole session while each caller believes it restored
    // it. The failure is silent: the app simply stops receiving updates.
    const RESTART_OWNERS = [
        'utils/InitialLoad/bootIntegrityHealer.js',
        'utils/backends/firestore.js',
        'utils/connectionHealth.js',
    ]

    it('every module that cycles the network imports the lease', () => {
        RESTART_OWNERS.forEach(owner => {
            const source = read(path.join(ROOT, owner))
            expect(source).toContain('runExclusiveFirestoreRestart')
        })
    })

    it('no other module cycles the network on its own', () => {
        // firestoreNetworkGate parks and resumes the transport on the offline/online
        // transitions — separate branches, never a cycle — so it is not a restart owner.
        const allowed = new Set([
            ...RESTART_OWNERS,
            'utils/backends/firestoreNetworkGate.js',
            'utils/backends/firestoreRestartLease.js',
        ])

        const offenders = sourceFiles()
            .filter(file => {
                const source = read(file)
                return /\.disableNetwork\(/.test(source) && /\.enableNetwork\(/.test(source)
            })
            .map(file => path.relative(ROOT, file))
            .filter(file => !allowed.has(file))

        expect(offenders).toEqual([])
    })
})

describe('PT-4660: the connection telemetry is actually registered', () => {
    // normalizeAnalyticsEvent is an ALLOWLIST with `default: return null`, and
    // sanitizeAnalyticsParameters drops unlisted keys. An event missing from either
    // set is silently discarded — nothing fails, the events just never arrive, which
    // is the same trap envFunctionsHelper.js documents for secrets.
    const analytics = read(path.join(ROOT, 'utils/analytics/analytics.js'))

    it.each(['connection_health_change', 'connection_stale_detected', 'connection_manual_reconnect'])(
        'registers the %s event',
        event => {
            expect(analytics).toContain(`'${event}'`)
        }
    )

    it.each(['state_from', 'state_to', 'trigger', 'duration_ms', 'browser_online', 'outcome'])(
        'registers the %s parameter',
        parameter => {
            expect(analytics).toContain(`'${parameter}'`)
        }
    )
})
