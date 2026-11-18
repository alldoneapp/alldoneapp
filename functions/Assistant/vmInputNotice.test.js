// AT-3065: a VM that waits for the user says so in Anna's conversation when it is Anna's work.

const mockStore = new Map()

const makeRef = path => ({
    path,
    get: async () => ({ exists: mockStore.has(path), data: () => mockStore.get(path) }),
    set: async (data, options) => {
        mockStore.set(path, options && options.merge ? { ...(mockStore.get(path) || {}), ...data } : data)
    },
})

const mockDb = {
    doc: path => makeRef(path),
    runTransaction: async handler =>
        handler({ get: ref => ref.get(), set: (ref, data, options) => ref.set(data, options) }),
}

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => mockDb) }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: -1,
    DONE_STEP: -2,
    getBaseUrl: () => 'https://my.alldone.app',
}))

const mockCreateInitialStatusMessage = jest.fn(async () => {})
jest.mock('./assistantStatusHelper', () => ({ createInitialStatusMessage: mockCreateInitialStatusMessage }))

const { buildVmInputNoticeText, notifyVmInputNeededInOrigin } = require('./vmInputNotice')

const PROJECT = 'p1'
const TASK = 't1'
const OWNER = 'karsten'
const JOB = 'pendingWebhooks/job-1'

const question = {
    requestId: 'req-1',
    kind: 'clarification',
    questions: [
        { header: 'Scope', question: 'Should the fix also cover the mobile popup?' },
        { header: 'Tests', question: 'Add a regression test?' },
    ],
}

const delegatedTask = (overrides = {}) => ({
    userId: OWNER,
    name: 'Fix the popup',
    humanReadableId: 'AT-1',
    taskMetadata: { delegation: { ownerId: OWNER, assistantId: 'cto', requiresReview: true } },
    ...overrides,
})

const job = (overrides = {}) => ({
    correlationId: 'job-1',
    userId: OWNER,
    projectId: PROJECT,
    objectType: 'tasks',
    objectId: TASK,
    ...overrides,
})

const seedWaitingJob = (overrides = {}) =>
    mockStore.set(JOB, { status: 'awaiting_user', interactionRequestId: 'req-1', ...overrides })

const notify = (pendingWebhook = job(), interaction = question) =>
    notifyVmInputNeededInOrigin({
        db: mockDb,
        pendingRef: makeRef(JOB),
        pendingWebhook,
        interaction,
        agentLabel: 'Claude',
    })

beforeEach(() => {
    mockStore.clear()
    jest.clearAllMocks()
    seedWaitingJob()
    mockStore.set(`items/${PROJECT}/tasks/${TASK}`, delegatedTask())
    mockStore.set(`delegatedTaskOrigins/${PROJECT}__${TASK}`, {
        ownerId: OWNER,
        originProjectId: 'privat',
        originObjectType: 'topics',
        originObjectId: 'AnnaChat20261117karsten',
        originAssistantId: 'anna',
    })
})

describe('notifyVmInputNeededInOrigin', () => {
    it("asks in Anna's conversation, once, when a VM on a task she delegated waits for the user", async () => {
        expect(await notify()).toBe(true)
        expect(await notify()).toBe(false)

        expect(mockCreateInitialStatusMessage).toHaveBeenCalledTimes(1)
        const [projectId, objectType, objectId, assistantId, text, notifyIds, , followerIds] =
            mockCreateInitialStatusMessage.mock.calls[0]
        expect([projectId, objectType, objectId, assistantId]).toEqual([
            'privat',
            'topics',
            'AnnaChat20261117karsten',
            'anna',
        ])
        expect(notifyIds).toEqual([OWNER])
        expect(followerIds).toEqual([OWNER])
        expect(text).toContain('💬 Claude needs your input on AT-1 “Fix the popup” before it continues.')
        expect(text).toContain('• Should the fix also cover the mobile popup?')
        expect(text).toContain('• Add a regression test?')
        expect(text).toContain(`https://my.alldone.app/projects/${PROJECT}/tasks/${TASK}/chat`)
        expect(mockStore.get(JOB).originInputNoticeRequestId).toBe('req-1')
    })

    it('uses the origin conversation the job carries when an assistant started it elsewhere', async () => {
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, { userId: OWNER, name: 'Research competitors' })
        const fromWhatsApp = job({
            originProjectId: 'privat',
            originObjectType: 'topics',
            originObjectId: 'whatsapp-topic',
            originAssistantId: 'anna',
        })
        expect(await notify(fromWhatsApp)).toBe(true)
        const [projectId, , objectId, assistantId, text] = mockCreateInitialStatusMessage.mock.calls[0]
        expect([projectId, objectId, assistantId]).toEqual(['privat', 'whatsapp-topic', 'anna'])
        expect(text).toContain('on “Research competitors”')
    })

    it('announces the next question of the same job again', async () => {
        expect(await notify()).toBe(true)
        seedWaitingJob({ interactionRequestId: 'req-2', originInputNoticeRequestId: 'req-1' })
        expect(await notify(job(), { ...question, requestId: 'req-2' })).toBe(true)
        expect(mockCreateInitialStatusMessage).toHaveBeenCalledTimes(2)
    })

    it('stays quiet for a VM the user started on a task Anna did not delegate', async () => {
        mockStore.set(`items/${PROJECT}/tasks/${TASK}`, { userId: OWNER, name: 'My own task' })
        expect(await notify()).toBe(false)
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    it("does not send another member's VM question to the delegating user's conversation", async () => {
        expect(await notify(job({ userId: 'colleague' }))).toBe(false)
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    it('skips a question that was answered before the notice went out', async () => {
        seedWaitingJob({ status: 'running' })
        expect(await notify()).toBe(false)
        seedWaitingJob({ interactionRequestId: 'req-2' })
        expect(await notify()).toBe(false)
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    it('asks in the user’s app language (AT-3082)', async () => {
        mockStore.set(`users/${OWNER}`, { language: 'de' })
        expect(await notify()).toBe(true)
        const text = mockCreateInitialStatusMessage.mock.calls[0][4]
        expect(text).toContain('💬 Claude braucht deine Antwort zu AT-1 „Fix the popup“, bevor es weitergeht.')
        // The VM's own questions are shown as the VM wrote them.
        expect(text).toContain('• Should the fix also cover the mobile popup?')
        expect(text).toContain(`Antworte im Task-Chat: https://my.alldone.app/projects/${PROJECT}/tasks/${TASK}/chat`)
    })

    it('never throws when posting fails', async () => {
        mockCreateInitialStatusMessage.mockRejectedValueOnce(new Error('boom'))
        expect(await notify()).toBe(false)
    })
})

describe('buildVmInputNoticeText', () => {
    const link = 'https://my.alldone.app/projects/p1/tasks/t1/chat'

    it('shows the start of a plan to review', () => {
        const text = buildVmInputNoticeText({
            interaction: { kind: 'plan_review', plan: `1. Change the popup\n${'x'.repeat(900)}` },
            agentLabel: 'Codex',
            task: { humanReadableId: 'AT-1', name: 'Fix the popup' },
            link,
        })
        expect(text).toContain('🗒️ Codex prepared a plan on AT-1 “Fix the popup” and waits for your review')
        expect(text).toContain('1. Change the popup')
        expect(text.length).toBeLessThan(900)
        expect(text.endsWith(`Answer it in the task chat: ${link}`)).toBe(true)
    })

    it('writes the fixed words in Spanish and German', () => {
        const es = buildVmInputNoticeText({
            interaction: { kind: 'plan_review', plan: 'Plan' },
            agentLabel: '',
            task: { name: 'Arreglar' },
            link,
            language: 'es',
        })
        expect(es).toContain('🗒️ La VM preparó un plan en “Arreglar” y espera tu revisión antes de ejecutarlo.')
        const de = buildVmInputNoticeText({
            interaction: { kind: 'tool_approval', toolName: 'git push' },
            agentLabel: 'Claude',
            task: null,
            link,
            language: 'de',
        })
        expect(de).toContain('🔐 Claude braucht deine Freigabe, bevor es weitergeht: git push.')
    })

    it('names the operation to approve without its command', () => {
        const text = buildVmInputNoticeText({
            interaction: {
                kind: 'tool_approval',
                toolName: 'git push',
                reason: 'Pushes the branch to GitLab.',
                command: 'git push origin fix --token=secret',
            },
            agentLabel: 'Claude',
            task: null,
            link,
        })
        expect(text).toContain('🔐 Claude needs your approval before it continues: git push.')
        expect(text).toContain('Pushes the branch to GitLab.')
        expect(text).not.toContain('secret')
    })
})
