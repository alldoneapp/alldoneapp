import fs from 'fs'
import path from 'path'

import { buildConnectionId, listCalendarConnections, listEmailConnections } from './IntegrationProviders'

// AT-2491. A connected Gmail account whose OAuth grant dies is flagged server-side as
// `emailConnections.<id>.authInvalid = true`, and Settings > Integrations renders a
// reconnect state off that flag. The flag reached the client through exactly one funnel —
// `mapUserData` — and that funnel is a strict whitelist which never listed the connection
// maps. So `listConnections` always fell through to synthesizing from the legacy
// `apisConnected` shape, which hardcodes `authInvalid: false`, and a revoked account
// rendered as perfectly healthy. Verified in production: a user document carrying
// `authInvalid: true` for four days while the UI showed nothing.
describe('connection auth state reaches the client (AT-2491)', () => {
    const CONNECTION_ID = buildConnectionId('email', 'google', 'karsten.wysk@gmail.com')

    const userWithStoredMap = overrides => ({
        emailConnections: {
            [CONNECTION_ID]: {
                provider: 'google',
                emailAddress: 'karsten.wysk@gmail.com',
                defaultProjectId: 'project-1',
                isDefaultAccount: true,
                ...overrides,
            },
        },
    })

    test('surfaces a revoked account from the stored connection map', () => {
        const [connection] = listEmailConnections(userWithStoredMap({ authInvalid: true }))

        expect(connection.authInvalid).toBe(true)
        expect(connection.email).toBe('karsten.wysk@gmail.com')
    })

    test('leaves a healthy account unflagged', () => {
        const [connection] = listEmailConnections(userWithStoredMap({ authInvalid: false }))

        expect(connection.authInvalid).toBe(false)
    })

    test('carries the moment the connection broke, for the "since" line', () => {
        const millis = Date.UTC(2026, 7, 29, 10, 59, 5)
        const [fromTimestamp] = listEmailConnections(
            userWithStoredMap({ authInvalid: true, authInvalidAt: { toMillis: () => millis } })
        )
        // UserDataCache stringifies the logged user into localStorage, so a cached boot
        // hands back the plain `{seconds}` shape instead of a Timestamp.
        const [fromCachedShape] = listEmailConnections(
            userWithStoredMap({ authInvalid: true, authInvalidAt: { seconds: millis / 1000 } })
        )

        expect(fromTimestamp.authInvalidAt).toBe(millis)
        expect(fromCachedShape.authInvalidAt).toBe(millis)
    })

    test('reports an unknown breakage time as 0, never as the epoch', () => {
        // Every connection flagged before AT-2491 started recording `authInvalidAt`.
        const [connection] = listEmailConnections(userWithStoredMap({ authInvalid: true }))

        expect(connection.authInvalidAt).toBe(0)
    })

    test('a legacy connection synthesized from apisConnected still reports a known-good shape', () => {
        // No stored map: the fallback cannot know about revocation, but it must not invent
        // a timestamp either.
        const [connection] = listEmailConnections({
            apisConnected: { 'project-1': { gmail: true, gmailEmail: 'karsten.wysk@gmail.com', gmailDefault: true } },
        })

        expect(connection.legacy).toBe(true)
        expect(connection.authInvalid).toBe(false)
        expect(connection.authInvalidAt).toBe(0)
    })

    test('calendar connections carry the same state', () => {
        const calendarId = buildConnectionId('calendar', 'google', 'karsten.wysk@gmail.com')
        const [connection] = listCalendarConnections({
            calendarConnections: {
                [calendarId]: {
                    provider: 'google',
                    emailAddress: 'karsten.wysk@gmail.com',
                    defaultProjectId: 'project-1',
                    authInvalid: true,
                },
            },
        })

        expect(connection.authInvalid).toBe(true)
    })
})

// `utils/backends/firestore.js` cannot be imported under jest — it reads dotenv variables
// at module scope and the suite has no `.env` — which is precisely why no test ever covered
// this mapper and why the omission survived. Assert on the source instead: the point is
// that the two field names are present in the whitelist at all.
describe('mapUserData whitelist (AT-2491 regression guard)', () => {
    const source = fs.readFileSync(path.join(__dirname, 'backends', 'firestore.js'), 'utf8')
    const mapUserDataBody = source.slice(source.indexOf('export function mapUserData'))

    test.each(['emailConnections', 'calendarConnections'])(
        'mapUserData carries %s through to the logged user',
        field => {
            expect(mapUserDataBody).toContain(`${field}: user.${field}`)
        }
    )
})
