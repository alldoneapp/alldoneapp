// AT-3082: a template started in the Anna chat announces its new task there (start + result).

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({ doc: jest.fn() })) }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ getBaseUrl: () => 'https://my.alldone.app' }))
jest.mock('./assistantStatusHelper', () => ({ createInitialStatusMessage: jest.fn().mockResolvedValue(undefined) }))
jest.mock('./vmResultSummary', () => ({ summarizeVmResultForChat: jest.fn() }))

const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { summarizeVmResultForChat } = require('./vmResultSummary')
const {
    TASK_RESULT_SUMMARY_GOLD_SOURCE,
    buildResultNoticeText,
    buildStartNoticeText,
    classifyRunOutcome,
    postPreConfigResultNotice,
    postPreConfigStartNotice,
    readRequestedOrigin,
    resolvePreConfigOrigin,
} = require('./preConfigOriginNotice')

const USER = 'user-1'
const ANNA_CHAT = `AnnaChat20261118${USER}`
const TASK = { extendedName: 'Historical fact of the day', name: 'Historical fact of the day', humanReadableId: 'PT-7' }
const LINK = 'https://my.alldone.app/projects/p-task/tasks/task-1/chat'
const ORIGIN = {
    originProjectId: 'p-anna',
    originObjectType: 'topics',
    originObjectId: ANNA_CHAT,
    originAssistantId: 'anna-1',
}

const snap = data => ({ exists: data !== null, data: () => data })

function makeDb(docs = {}) {
    return {
        doc: jest.fn(path => ({
            get: jest.fn(() => {
                const value = docs[path]
                if (value instanceof Error) return Promise.reject(value)
                return Promise.resolve(snap(value === undefined ? null : value))
            }),
        })),
    }
}

const ownAnnaChat = {
    type: 'topics',
    annaOwnerId: USER,
    creatorId: USER,
    assistantId: 'anna-1',
}

describe('readRequestedOrigin', () => {
    test('accepts an Anna topic and defaults the type to topics', () => {
        expect(readRequestedOrigin({ projectId: 'p-anna', objectId: ANNA_CHAT }, {})).toEqual({
            originProjectId: 'p-anna',
            originObjectType: 'topics',
            originObjectId: ANNA_CHAT,
        })
    })

    test('refuses other object types, malformed ids and the task thread itself', () => {
        expect(readRequestedOrigin({ projectId: 'p', objectId: 'x', objectType: 'tasks' })).toBeNull()
        expect(readRequestedOrigin({ projectId: 'p/../q', objectId: 'x' })).toBeNull()
        expect(readRequestedOrigin({ projectId: 'p', objectId: '' })).toBeNull()
        expect(readRequestedOrigin(null)).toBeNull()
        expect(readRequestedOrigin({ projectId: 'p', objectId: 't' }, { projectId: 'p', taskId: 't' })).toBeNull()
    })
})

describe('resolvePreConfigOrigin', () => {
    const request = { projectId: 'p-anna', objectType: 'topics', objectId: ANNA_CHAT }

    test("resolves the caller's own Anna chat and takes the assistant from the chat document", async () => {
        const db = makeDb({
            'projects/p-anna': { userIds: [USER] },
            [`chatObjects/p-anna/chats/${ANNA_CHAT}`]: ownAnnaChat,
        })
        const origin = await resolvePreConfigOrigin({
            db,
            userId: USER,
            requestedOrigin: { ...request, assistantId: 'spoofed' },
            projectId: 'p-task',
            taskId: 'task-1',
        })
        expect(origin).toEqual(ORIGIN)
    })

    test('refuses a project the caller is not a member of', async () => {
        const db = makeDb({
            'projects/p-anna': { userIds: ['someone-else'] },
            [`chatObjects/p-anna/chats/${ANNA_CHAT}`]: ownAnnaChat,
        })
        await expect(resolvePreConfigOrigin({ db, userId: USER, requestedOrigin: request })).resolves.toBeNull()
    })

    test("refuses another member's chat, a non-topic chat or a chat without assistant", async () => {
        for (const chat of [
            { ...ownAnnaChat, annaOwnerId: 'other' },
            { ...ownAnnaChat, creatorId: 'other' },
            { ...ownAnnaChat, type: 'tasks' },
            { ...ownAnnaChat, assistantId: '' },
            null,
        ]) {
            const db = makeDb({
                'projects/p-anna': { userIds: [USER] },
                [`chatObjects/p-anna/chats/${ANNA_CHAT}`]: chat,
            })
            await expect(resolvePreConfigOrigin({ db, userId: USER, requestedOrigin: request })).resolves.toBeNull()
        }
    })

    test('fails closed on a read error', async () => {
        const db = makeDb({ 'projects/p-anna': new Error('unavailable') })
        await expect(resolvePreConfigOrigin({ db, userId: USER, requestedOrigin: request })).resolves.toBeNull()
    })
})

describe('notice texts', () => {
    test('the start line names the actual task and links it', () => {
        expect(buildStartNoticeText({ task: TASK, link: LINK })).toBe(
            `🚀 I started PT-7 “Historical fact of the day” for you. I will tell you here when it is done.\n${LINK}`
        )
    })

    test('the result line carries the summary only for a real answer', () => {
        expect(
            buildResultNoticeText({ task: TASK, outcome: 'done', summary: 'Am 18. November 1928 …', link: LINK })
        ).toBe(`✅ PT-7 “Historical fact of the day” is done.\n\nAm 18. November 1928 …\n${LINK}`)
        expect(buildResultNoticeText({ task: TASK, outcome: 'failed', summary: 'ignored', link: LINK })).toBe(
            `⚠️ PT-7 “Historical fact of the day” could not finish. The details are in the task.\n${LINK}`
        )
        expect(buildResultNoticeText({ task: { name: 'X' }, outcome: 'result', link: LINK })).toBe(
            `✅ “X” has its result.\n${LINK}`
        )
    })

    test('every outcome line exists in German and Spanish', () => {
        const de = outcome => buildResultNoticeText({ task: TASK, outcome, link: LINK, language: 'de' }).split('\n')[0]
        expect(de('failed')).toBe(
            '⚠️ PT-7 „Historical fact of the day“ konnte nicht abgeschlossen werden. Die Details stehen im Task.'
        )
        expect(de('waiting')).toBe(
            '💬 PT-7 „Historical fact of the day“ ist bereit und wartet im Task auf deine Nachricht.'
        )
        expect(de('no_answer')).toMatch(/^✅ PT-7 „Historical fact of the day“ ist fertig/)
        expect(de('result')).toBe('✅ PT-7 „Historical fact of the day“ hat ein Ergebnis.')
        expect(buildStartNoticeText({ task: TASK, link: LINK, language: 'es' })).toBe(
            `🚀 He iniciado PT-7 “Historical fact of the day” para ti. Te avisaré aquí cuando esté lista.\n${LINK}`
        )
    })

    test('classifies the run outcome', () => {
        const answer = { success: true, commentText: 'A fact.' }
        expect(classifyRunOutcome({ result: answer, taskCompletion: { status: 'succeeded' } })).toBe('done')
        expect(classifyRunOutcome({ result: answer, taskCompletion: { status: 'failed' } })).toBe('result')
        expect(classifyRunOutcome({ result: answer, taskCompletion: null })).toBe('result')
        expect(classifyRunOutcome({ result: { ...answer, silentOk: true } })).toBe('no_answer')
        expect(classifyRunOutcome({ result: { success: true, commentText: '  ' } })).toBe('no_answer')
        expect(classifyRunOutcome({ result: { success: true, status: 'webhook_ready' } })).toBe('waiting')
        expect(classifyRunOutcome({ error: new Error('boom') })).toBe('failed')
        expect(classifyRunOutcome({ result: { success: false } })).toBe('failed')
    })
})

describe('posting', () => {
    beforeEach(() => jest.clearAllMocks())

    const taskDb = () => makeDb({ 'items/p-task/tasks/task-1': TASK })

    test('the start notice goes to the Anna chat as its assistant, without a bell', async () => {
        await expect(
            postPreConfigStartNotice({
                db: taskDb(),
                origin: ORIGIN,
                projectId: 'p-task',
                taskId: 'task-1',
                userId: USER,
            })
        ).resolves.toBe(true)
        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'p-anna',
            'topics',
            ANNA_CHAT,
            'anna-1',
            expect.stringContaining('🚀 I started PT-7 “Historical fact of the day”'),
            [],
            [],
            [USER]
        )
    })

    test('the result notice summarizes the actual answer of the task thread', async () => {
        summarizeVmResultForChat.mockResolvedValue('Am 18. November 1928 lief „Steamboat Willie“ an.')
        await postPreConfigResultNotice({
            db: taskDb(),
            origin: ORIGIN,
            projectId: 'p-task',
            taskId: 'task-1',
            userId: USER,
            result: { success: true, commentText: 'On 18 November 1928 Steamboat Willie premiered …' },
            taskCompletion: { status: 'succeeded' },
        })
        expect(summarizeVmResultForChat).toHaveBeenCalledWith(
            expect.objectContaining({
                resultText: 'On 18 November 1928 Steamboat Willie premiered …',
                userId: USER,
                projectId: 'p-task',
                objectId: 'task-1',
                taskLabel: 'PT-7 “Historical fact of the day”',
                goldSource: TASK_RESULT_SUMMARY_GOLD_SOURCE,
            })
        )
        expect(createInitialStatusMessage.mock.calls[0][4]).toBe(
            `✅ PT-7 “Historical fact of the day” is done.\n\nAm 18. November 1928 lief „Steamboat Willie“ an.\n${LINK}`
        )
        expect(createInitialStatusMessage.mock.calls[0][5]).toEqual([])
    })

    test('a failed run posts the failure line and asks for no summary', async () => {
        await postPreConfigResultNotice({
            db: taskDb(),
            origin: ORIGIN,
            projectId: 'p-task',
            taskId: 'task-1',
            userId: USER,
            error: new Error('model down'),
        })
        expect(summarizeVmResultForChat).not.toHaveBeenCalled()
        expect(createInitialStatusMessage.mock.calls[0][4]).toMatch(/^⚠️ PT-7/)
    })

    test('both lines are in the user’s app language (AT-3082: German for Karsten)', async () => {
        summarizeVmResultForChat.mockResolvedValue('Am 18. November 1928 lief „Steamboat Willie“ an.')
        const db = makeDb({ 'items/p-task/tasks/task-1': TASK, [`users/${USER}`]: { language: 'de' } })
        const ids = { db, origin: ORIGIN, projectId: 'p-task', taskId: 'task-1', userId: USER }
        await postPreConfigStartNotice(ids)
        await postPreConfigResultNotice({
            ...ids,
            result: { success: true, commentText: 'On 18 November 1928 …' },
            taskCompletion: { status: 'succeeded' },
        })
        expect(createInitialStatusMessage.mock.calls[0][4]).toBe(
            `🚀 Ich habe PT-7 „Historical fact of the day“ für dich gestartet. Ich melde mich hier, sobald es fertig ist.\n${LINK}`
        )
        expect(createInitialStatusMessage.mock.calls[1][4]).toBe(
            `✅ PT-7 „Historical fact of the day“ ist erledigt.\n\nAm 18. November 1928 lief „Steamboat Willie“ an.\n${LINK}`
        )
        expect(summarizeVmResultForChat).toHaveBeenCalledWith(
            expect.objectContaining({ language: 'de', taskLabel: 'PT-7 „Historical fact of the day“' })
        )
    })

    test('a user without a stored language gets English', async () => {
        await postPreConfigStartNotice({
            db: makeDb({ 'items/p-task/tasks/task-1': TASK, [`users/${USER}`]: new Error('unavailable') }),
            origin: ORIGIN,
            projectId: 'p-task',
            taskId: 'task-1',
            userId: USER,
        })
        expect(createInitialStatusMessage.mock.calls[0][4]).toMatch(/^🚀 I started PT-7/)
    })

    test('without an origin nothing is posted', async () => {
        await expect(postPreConfigStartNotice({ origin: null, projectId: 'p', taskId: 't' })).resolves.toBe(false)
        await expect(postPreConfigResultNotice({ origin: null, projectId: 'p', taskId: 't' })).resolves.toBe(false)
        expect(createInitialStatusMessage).not.toHaveBeenCalled()
    })

    test('a posting error never fails the run', async () => {
        createInitialStatusMessage.mockRejectedValueOnce(new Error('write failed'))
        await expect(
            postPreConfigStartNotice({
                db: taskDb(),
                origin: ORIGIN,
                projectId: 'p-task',
                taskId: 'task-1',
                userId: USER,
            })
        ).resolves.toBe(false)
    })
})

// index.js cannot be require()d in a unit test (it registers every function), so the callable's
// wiring is read as source, like assistantRunIdempotencyHosts.test.js does.
describe('generatePreConfigTaskResultSecondGen wiring', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const start = source.indexOf('exports.generatePreConfigTaskResultSecondGen = ')
    const body = source.slice(start, source.indexOf('\nexports.', start + 1))

    test('announces only from the run that owns the lock, so a replayed request posts nothing twice', () => {
        const lockCheck = body.indexOf('if (!assistantRunLock.acquired)')
        expect(lockCheck).toBeGreaterThan(-1)
        expect(body.indexOf('resolvePreConfigOrigin(')).toBeGreaterThan(lockCheck)
        expect(body.indexOf('postPreConfigStartNotice(')).toBeGreaterThan(lockCheck)
    })

    test('resolves the origin on the server instead of trusting request data', () => {
        expect(body).toMatch(/requestedOrigin: requestedOriginConversation/)
        expect(body).not.toMatch(/origin: requestedOriginConversation/)
    })

    test('posts the result after the task completion and hands the origin to the run', () => {
        const completion = body.indexOf('const taskCompletion = await completeOnDemandAssistantTaskAfterRun(')
        const resultNotices = [...body.matchAll(/postPreConfigResultNotice\(/g)].map(match => match.index)
        expect(resultNotices).toHaveLength(2) // success path and failure path
        expect(resultNotices[1]).toBeGreaterThan(completion)
        expect(body).toContain('{ triggerMessageId: messageId, ...(originConversation || {}) }')
    })
})
