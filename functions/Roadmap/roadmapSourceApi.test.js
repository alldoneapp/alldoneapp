'use strict'

// POST /api/roadmap/source: signed like the Gold webhook, finds the alldone.app account,
// lists its roadmap projects and returns one project's snapshot. The snapshot's equality with the
// embed bridge's is pinned in __tests__/Roadmap/roadmapSourceParity.test.js.

const crypto = require('crypto')

const { createFakeFirestore } = require('../Tests/fakeFirestore')
const { handleRoadmapSource, __private__ } = require('./roadmapSourceApi')

const SECRET = 'shared-roadmap-secret'
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)

function sign(rawBody, { secret = SECRET, timestamp = Math.floor(NOW / 1000) } = {}) {
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
    return { 'x-alldone-timestamp': String(timestamp), 'x-alldone-signature': signature }
}

function request(body, { headers, method = 'POST', signOptions } = {}) {
    const rawBody = JSON.stringify(body)
    return {
        method,
        body,
        rawBody: Buffer.from(rawBody),
        headers: headers || sign(rawBody, signOptions),
    }
}

function response() {
    const res = { statusCode: 200, body: null, headers: {} }
    res.set = (key, value) => {
        res.headers[key] = value
        return res
    }
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

function seed() {
    return createFakeFirestore({
        'users/app-user': {
            projectIds: ['p-zulu', 'p-alpha', 'p-archived', 'p-left', 'p-guide'],
            archivedProjectIds: ['p-archived'],
            guideProjectIds: ['p-guide'],
        },
        'users/other-user': { projectIds: ['p-alpha'] },
        'projects/p-zulu': { name: 'Zulu', color: '#FF5274', userIds: ['app-user'] },
        'projects/p-alpha': {
            name: 'Alpha',
            color: '#not-a-marker',
            userIds: ['app-user', 'other-user'],
            focusAreas: { fa1: { name: '  Growth   team ' }, fa2: { name: 'General' } },
        },
        'projects/p-archived': { name: 'Archived', userIds: ['app-user'] },
        // Still listed on the user document, but the project no longer lists the user.
        'projects/p-left': { name: 'Left', userIds: ['someone-else'] },
        'projects/p-guide': { name: 'Guide', userIds: ['app-user'] },
        'projects/p-foreign': { name: 'Foreign', userIds: ['someone-else'] },
        'goals/p-alpha/items/g1': {
            extendedName: 'Launch',
            progress: 40,
            readerIds: ['app-user'],
            ownerId: 'ALL_USERS',
            focusAreaId: 'fa1',
        },
        'goals/p-alpha/items/g-hidden': { extendedName: 'Hidden', readerIds: ['other-user'], ownerId: 'ALL_USERS' },
        'goalsMilestones/p-alpha/milestonesItems/m1': { extendedName: 'Q1', date: NOW, ownerId: 'ALL_USERS' },
        'okrs/p-alpha/projectOkrs/o1': {
            label: 'Signups',
            currentValue: 50,
            targetValue: 100,
            periodStart: NOW - 1000,
            periodEnd: NOW + 1000,
            ownerId: 'app-user',
            readerIds: ['app-user'],
        },
    })
}

let db
let lookups

function deps(overrides = {}) {
    return {
        db,
        env: { MENUBAR_APP_WEBHOOK_SECRET: SECRET },
        findUserIdByEmail: async email => {
            lookups.push(email)
            return email === 'person@example.com' ? 'app-user' : null
        },
        ...overrides,
    }
}

async function call(body, options = {}, depOverrides = {}) {
    const res = response()
    await handleRoadmapSource(request(body, options), res, deps(depOverrides))
    return res
}

beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    db = seed()
    lookups = []
})

afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
})

const projectsBody = { action: 'projects', account: { appAccountId: 'app-user' } }

describe('signature', () => {
    test('a valid signature is accepted', async () => {
        const res = await call(projectsBody)
        expect(res.statusCode).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.headers['Cache-Control']).toBe('no-store')
    })

    test('the secret may sit under EXTERNAL_TOOLS_SIGNING_SECRET, as for the Gold webhook', async () => {
        const res = await call(projectsBody, {}, { env: { EXTERNAL_TOOLS_SIGNING_SECRET: `${SECRET}\n` } })
        expect(res.statusCode).toBe(200)
    })

    test('a signature made with another secret is refused', async () => {
        const res = await call(projectsBody, { signOptions: { secret: 'wrong' } })
        expect(res.statusCode).toBe(401)
        expect(res.body).toEqual({ success: false, error: 'INVALID_SIGNATURE' })
    })

    test('a signature over another body is refused', async () => {
        const headers = sign(JSON.stringify({ ...projectsBody, account: { appAccountId: 'other-user' } }))
        const res = await call(projectsBody, { headers })
        expect(res.statusCode).toBe(401)
    })

    test('a timestamp more than five minutes off is refused, in either direction', async () => {
        const stale = await call(projectsBody, { signOptions: { timestamp: Math.floor(NOW / 1000) - 301 } })
        const future = await call(projectsBody, { signOptions: { timestamp: Math.floor(NOW / 1000) + 301 } })
        const edge = await call(projectsBody, { signOptions: { timestamp: Math.floor(NOW / 1000) - 299 } })
        expect(stale.statusCode).toBe(401)
        expect(future.statusCode).toBe(401)
        expect(edge.statusCode).toBe(200)
    })

    test('missing headers are refused', async () => {
        const res = await call(projectsBody, { headers: {} })
        expect(res.statusCode).toBe(401)
        expect(res.body.error).toBe('INVALID_SIGNATURE')
    })

    test('without a configured secret the endpoint answers 503 and reads nothing', async () => {
        const res = await call(projectsBody, {}, { env: {}, db: null })
        expect(res.statusCode).toBe(503)
        expect(res.body).toEqual({ success: false, error: 'SIGNING_NOT_CONFIGURED' })
    })

    test('only POST is served', async () => {
        const res = await call(projectsBody, { method: 'GET' })
        expect(res.statusCode).toBe(405)
    })
})

describe('request validation', () => {
    test.each([
        ['unknown action', { action: 'delete', account: { appAccountId: 'app-user' } }, 'INVALID_ACTION'],
        ['no account', { action: 'projects' }, 'INVALID_ACCOUNT'],
        ['empty account', { action: 'projects', account: {} }, 'INVALID_ACCOUNT'],
        ['path in account id', { action: 'projects', account: { appAccountId: 'a/b' } }, 'INVALID_ACCOUNT'],
        [
            'snapshot without project',
            { action: 'snapshot', account: { appAccountId: 'app-user' } },
            'INVALID_PROJECT_ID',
        ],
        [
            'path in project id',
            { action: 'snapshot', account: { appAccountId: 'app-user' }, projectId: 'p/../x' },
            'INVALID_PROJECT_ID',
        ],
    ])('%s → 400', async (_, body, error) => {
        const res = await call(body)
        expect(res.statusCode).toBe(400)
        expect(res.body).toEqual({ success: false, error })
    })
})

describe('account lookup', () => {
    test('finds the account by its alldone.app user id without an email lookup', async () => {
        const res = await call(projectsBody)
        expect(res.statusCode).toBe(200)
        expect(lookups).toEqual([])
    })

    test('falls back to the verified email when there is no account id', async () => {
        const res = await call({ action: 'projects', account: { email: 'person@example.com' } })
        expect(res.statusCode).toBe(200)
        expect(res.body.projects.map(project => project.id)).toEqual(['p-alpha', 'p-zulu'])
        expect(lookups).toEqual(['person@example.com'])
    })

    test('falls back to the verified email when the account id is unknown', async () => {
        const res = await call({ action: 'projects', account: { appAccountId: 'gone', email: 'person@example.com' } })
        expect(res.statusCode).toBe(200)
        expect(lookups).toEqual(['person@example.com'])
    })

    test('an unknown account is 404 ACCOUNT_NOT_FOUND', async () => {
        const byId = await call({ action: 'projects', account: { appAccountId: 'gone' } })
        const byEmail = await call({ action: 'projects', account: { email: 'nobody@example.com' } })
        expect(byId.statusCode).toBe(404)
        expect(byId.body).toEqual({ success: false, error: 'ACCOUNT_NOT_FOUND' })
        expect(byEmail.statusCode).toBe(404)
        expect(byEmail.body.error).toBe('ACCOUNT_NOT_FOUND')
    })
})

describe('projects', () => {
    test('lists active member projects as the minimal sorted DTO', async () => {
        const res = await call(projectsBody)
        expect(res.body).toEqual({
            success: true,
            projects: [
                { id: 'p-alpha', name: 'Alpha', color: '#47A3FF' },
                { id: 'p-zulu', name: 'Zulu', color: '#FF5274' },
            ],
        })
    })

    test('an account without projects gets an empty list', async () => {
        db.docs.set('users/empty-user', {})
        const res = await call({ action: 'projects', account: { appAccountId: 'empty-user' } })
        expect(res.body).toEqual({ success: true, projects: [] })
    })
})

describe('snapshot', () => {
    const snapshotBody = projectId => ({ action: 'snapshot', account: { appAccountId: 'app-user' }, projectId })

    test('returns the project the account can see', async () => {
        const res = await call(snapshotBody('p-alpha'))
        expect(res.statusCode).toBe(200)
        const { snapshot } = res.body
        expect(snapshot.project).toEqual({
            id: 'p-alpha',
            name: 'Alpha',
            color: '#47A3FF',
            focusAreas: [{ id: 'fa1', name: 'Growth team' }],
        })
        expect(snapshot.goals.map(goal => goal.id)).toEqual(['g1'])
        expect(snapshot.milestones.map(milestone => milestone.name)).toEqual(['Q1'])
        expect(snapshot.okrs).toEqual([
            expect.objectContaining({ id: 'o1', label: 'Signups', resolvedCurrentValue: 50, paceStatus: 'onTrack' }),
        ])
    })

    test('a project that does not list the account is 403 NOT_A_MEMBER', async () => {
        const foreign = await call(snapshotBody('p-foreign'))
        const left = await call(snapshotBody('p-left'))
        expect(foreign.statusCode).toBe(403)
        expect(foreign.body).toEqual({ success: false, error: 'NOT_A_MEMBER' })
        expect(left.statusCode).toBe(403)
    })

    test('an unknown project is 404 PROJECT_NOT_FOUND', async () => {
        const res = await call(snapshotBody('p-missing'))
        expect(res.statusCode).toBe(404)
        expect(res.body).toEqual({ success: false, error: 'PROJECT_NOT_FOUND' })
    })

    test('another member sees only what they may read', async () => {
        const res = await call({ action: 'snapshot', account: { appAccountId: 'other-user' }, projectId: 'p-alpha' })
        expect(res.body.snapshot.goals.map(goal => goal.id)).toEqual(['g-hidden'])
        expect(res.body.snapshot.okrs).toEqual([])
    })

    test('a read failure is 500 INTERNAL_ERROR', async () => {
        const failing = { ...db, doc: () => ({ get: async () => Promise.reject(new Error('boom')) }) }
        const res = await call(snapshotBody('p-alpha'), {}, { db: failing })
        expect(res.statusCode).toBe(500)
        expect(res.body).toEqual({ success: false, error: 'INTERNAL_ERROR' })
    })
})

describe('statistics day keys', () => {
    const { statisticsDayKey } = __private__
    const lateEvening = Date.UTC(2026, 10, 17, 23, 30)

    test('use the account zone, then its offset, then UTC', () => {
        expect(statisticsDayKey(lateEvening, { timezone: 'Europe/Berlin' })).toBe(20261118)
        expect(statisticsDayKey(lateEvening, { timezone: 1 })).toBe(20261118)
        expect(statisticsDayKey(lateEvening, { timezoneOffset: -300 })).toBe(20261117)
        expect(statisticsDayKey(lateEvening, {})).toBe(20261117)
    })
})
