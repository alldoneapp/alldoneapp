const mockDocs = new Map()
// In-memory stand-in for the labeling audit subcollection (messageId -> audit data).
const mockAuditDocs = new Map()
// In-memory stand-in for the tasks collection: `items/{projectId}/tasks` path -> [{ id, data }].
const mockTaskDocs = new Map()
jest.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: path => ({
            get: async () => {
                const data = mockDocs.get(path)
                return { exists: data !== undefined, data: () => data }
            },
            set: async (value, opts) => {
                const prev = mockDocs.get(path) || {}
                mockDocs.set(path, opts && opts.merge ? { ...prev, ...value } : value)
            },
        }),
        getAll: async (...refs) =>
            refs.map(ref => {
                const path = ref.path || ref.id
                const data = mockAuditDocs.has(path) ? mockAuditDocs.get(path) : mockAuditDocs.get(ref.id)
                return {
                    id: ref.id,
                    exists: data !== undefined,
                    data: () => data,
                }
            }),
        collection: path => ({
            where: (field, op, values) => ({
                get: async () => {
                    const entries = mockTaskDocs.get(path) || []
                    const matches = entries.filter(entry => {
                        const value = field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), entry.data)
                        return op === 'in' ? Array.isArray(values) && values.includes(value) : value === values
                    })
                    return { forEach: cb => matches.forEach(entry => cb({ id: entry.id, data: () => entry.data })) }
                },
            }),
        }),
    }),
}))

jest.mock('../../Gmail/gmailLabelingConfig', () => ({
    getGmailLabelingConfigRef: jest.fn(() => ({
        get: async () => {
            const data = mockDocs.get('labelingConfig')
            return { exists: data !== undefined, data: () => data }
        },
    })),
    getGmailLabelingStateRef: jest.fn((userId, projectId) => ({
        collection: () => ({
            doc: id => ({
                id,
                path: `audit:${projectId}:${id}`,
                set: async (value, opts) => {
                    const path = `audit:${projectId}:${id}`
                    const prev = mockAuditDocs.get(path) || mockAuditDocs.get(id) || {}
                    const next = opts && opts.merge ? { ...prev, ...value } : value
                    mockAuditDocs.set(path, next)
                    mockAuditDocs.set(id, next)
                },
            }),
            orderBy: () => ({
                limit: () => ({
                    get: async () => ({
                        docs: [...mockAuditDocs.entries()]
                            .filter(([id]) => !id.startsWith('audit:') || id.startsWith(`audit:${projectId}:`))
                            .map(([id, data]) => ({
                                id: id.startsWith('audit:') ? id.split(':').pop() : id,
                                data: () => data,
                            })),
                    }),
                }),
            }),
        }),
    })),
}))

jest.mock('../../Gmail/serverSideGmailLabelingSync', () => ({
    resolveEffectiveGmailLabelingConfig: jest.fn(config => config),
}))

jest.mock('./gmailEmailLine', () => ({
    getGmailLabelSummary: jest.fn(),
    listMessagesForLabel: jest.fn(),
    archiveMessages: jest.fn(),
    markMessagesRead: jest.fn(),
    sweepLabel: jest.fn(),
    getMessageContext: jest.fn(),
    getUnreadInboxMessageIds: jest.fn(),
    buildGmailMessageUrl: jest.fn(() => 'https://gmail/message'),
    stripLabelPrefix: jest.fn(name => (typeof name === 'string' ? name.split('/').pop() : '')),
}))

jest.mock('./taskSummarizer', () => ({
    summarizeEmailAsTaskName: jest.fn(),
    TASK_SUMMARY_MODEL_KEY: 'MODEL_GPT5_4_NANO',
}))

const mockCreateAndPersistTask = jest.fn()
jest.mock('../../shared/TaskService', () => ({
    TaskService: jest.fn(() => ({
        initialize: jest.fn(),
        createAndPersistTask: mockCreateAndPersistTask,
    })),
}))

const mockAddProjectRoutingReasonComment = jest.fn()
const mockGetDefaultAssistantIdForProject = jest.fn()
jest.mock('../../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: (...args) => mockAddProjectRoutingReasonComment(...args),
    getDefaultAssistantIdForProject: (...args) => mockGetDefaultAssistantIdForProject(...args),
}))

const mockTaskCommentServiceAddComment = jest.fn()
jest.mock('../../shared/TaskCommentService', () => ({
    TaskCommentService: jest.fn(() => ({
        addComment: mockTaskCommentServiceAddComment,
    })),
}))

jest.mock('./microsoftEmailLine', () => ({
    getMicrosoftLabelSummary: jest.fn(),
    listMessagesForLabel: jest.fn(),
    archiveMessages: jest.fn(),
    markMessagesRead: jest.fn(),
    sweepLabel: jest.fn(),
    getMessageContext: jest.fn(),
}))

jest.mock('./replyComposer', () => ({
    composeReply: jest.fn(),
    REPLY_MODEL_KEY: 'MODEL_GPT5_4_MINI',
}))

jest.mock('../../Gold/goldHelper', () => ({
    deductGold: jest.fn(),
    refundGold: jest.fn(),
}))

jest.mock('../../Assistant/assistantHelper', () => ({
    calculateGoldCostFromTokens: jest.fn(() => 5),
}))

jest.mock('../../Gmail/assistantGmailDrafts', () => ({
    createGmailReplyDraftForAssistantRequest: jest.fn(),
}))

const gmailEmailLine = require('./gmailEmailLine')
const microsoftEmailLine = require('./microsoftEmailLine')
const { composeReply } = require('./replyComposer')
const { summarizeEmailAsTaskName } = require('./taskSummarizer')
const { deductGold, refundGold } = require('../../Gold/goldHelper')
const { createGmailReplyDraftForAssistantRequest } = require('../../Gmail/assistantGmailDrafts')
const { getEmailLineSummary, listEmailLineMessages, performEmailLineAction } = require('./emailLineService')

const googleUserData = { apisConnected: { p1: { email: true, emailProvider: 'google', gmailEmail: 'me@gmail.com' } } }
const googleConnectionUserData = {
    ...googleUserData,
    emailConnections: {
        email_google_test: {
            provider: 'google',
            emailAddress: 'me@gmail.com',
            defaultProjectId: 'p1',
        },
    },
}
const microsoftUserData = {
    apisConnected: { p1: { email: true, emailProvider: 'microsoft', emailAddress: 'me@outlook.com' } },
}

describe('emailLineService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocs.clear()
        mockAuditDocs.clear()
        mockTaskDocs.clear()
        gmailEmailLine.getUnreadInboxMessageIds.mockResolvedValue([])
        mockAddProjectRoutingReasonComment.mockResolvedValue(null)
        mockGetDefaultAssistantIdForProject.mockResolvedValue('assistant-1')
        mockTaskCommentServiceAddComment.mockResolvedValue({ commentId: 'draft-comment-1' })
    })

    test('returns a disconnected summary when email is not connected', async () => {
        const summary = await getEmailLineSummary('u', 'p1', { userData: {} })
        expect(summary.connected).toBe(false)
        expect(summary.labels).toEqual([])
        expect(gmailEmailLine.getGmailLabelSummary).not.toHaveBeenCalled()
    })

    test('dispatches to the Gmail provider and computes inboxZero', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 0, kind: 'inbox' }],
        })
        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData })
        expect(summary.provider).toBe('google')
        expect(summary.inboxZero).toBe(true)
        expect(summary.emailAddress).toBe('me@gmail.com')
    })

    test('summary excludes Inbox and No label from label feedback options', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [
                { labelId: 'INBOX', displayName: 'Inbox', threadCount: 4, unreadCount: 1, kind: 'inbox' },
                { labelId: '__NO_LABEL__', displayName: 'No label', threadCount: 2, unreadCount: 1, kind: 'no_label' },
                { labelId: 'Label_ads', displayName: 'Ads', threadCount: 2, unreadCount: 1, kind: 'user' },
            ],
        })

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData })

        expect(summary.labelOptions).toEqual([{ gmailLabelName: 'Ads', displayName: 'Ads' }])
    })

    test('summary stamps project labels with their sourceProjectId and leaves Ads/Inbox/No label unmapped', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [
                {
                    labelId: 'INBOX',
                    name: 'INBOX',
                    displayName: 'Inbox',
                    threadCount: 5,
                    unreadCount: 1,
                    kind: 'inbox',
                },
                {
                    labelId: 'Label_mk',
                    name: 'Marketing',
                    displayName: 'Marketing',
                    threadCount: 3,
                    unreadCount: 1,
                    kind: 'user',
                },
                { labelId: 'Label_ads', name: 'Ads', displayName: 'Ads', threadCount: 2, unreadCount: 0, kind: 'user' },
                {
                    labelId: '__NO_LABEL__',
                    name: '__NO_LABEL__',
                    displayName: 'No label',
                    threadCount: 4,
                    unreadCount: 1,
                    kind: 'no_label',
                },
            ],
        })
        mockDocs.set('labelingConfig', {
            enabled: true,
            labelDefinitions: [
                { key: 'project_mk', gmailLabelName: 'Marketing', sourceProjectId: 'proj_marketing' },
                { key: 'ads', gmailLabelName: 'Ads' },
            ],
        })

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData })

        const byDisplay = Object.fromEntries(summary.labels.map(label => [label.displayName, label]))
        expect(byDisplay['Marketing'].projectId).toBe('proj_marketing')
        expect(byDisplay['Ads'].projectId).toBeUndefined()
        expect(byDisplay['Inbox'].projectId).toBeUndefined()
        expect(byDisplay['No label'].projectId).toBeUndefined()
    })

    test('dispatches to the Microsoft provider', async () => {
        microsoftEmailLine.getMicrosoftLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'f_inbox', unreadCount: 3, kind: 'inbox' }],
            emailAddress: 'me@outlook.com',
        })
        const summary = await getEmailLineSummary('u', 'p1', { userData: microsoftUserData })
        expect(summary.provider).toBe('microsoft')
        expect(summary.inboxZero).toBe(false)
    })

    test('maps provider auth errors to EMAIL_AUTH_EXPIRED', async () => {
        gmailEmailLine.getGmailLabelSummary.mockRejectedValue(new Error('invalid_grant: token expired'))
        await expect(getEmailLineSummary('u', 'p1', { userData: googleUserData })).rejects.toMatchObject({
            code: 'EMAIL_AUTH_EXPIRED',
        })
    })

    test('listEmailLineMessages forwards emailAddress to the provider', async () => {
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({ messages: [], nextPageToken: null })
        await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData, pageToken: 'pt' })
        expect(gmailEmailLine.listMessagesForLabel).toHaveBeenCalledWith('u', 'p1', 'INBOX', {
            pageToken: 'pt',
            emailAddress: 'me@gmail.com',
        })
    })

    test('performEmailLineAction routes archive/markRead/sweep', async () => {
        gmailEmailLine.archiveMessages.mockResolvedValue({ processed: 2 })
        gmailEmailLine.markMessagesRead.mockResolvedValue({ processed: 1 })
        gmailEmailLine.sweepLabel.mockResolvedValue({ processed: 5, remaining: false })

        await performEmailLineAction('u', 'p1', { action: 'archive', messageIds: ['a', 'b'], userData: googleUserData })
        expect(gmailEmailLine.archiveMessages).toHaveBeenCalledWith('u', 'p1', ['a', 'b'])

        await performEmailLineAction('u', 'p1', { action: 'markRead', messageIds: ['a'], userData: googleUserData })
        expect(gmailEmailLine.markMessagesRead).toHaveBeenCalledWith('u', 'p1', ['a'])

        await performEmailLineAction('u', 'p1', { action: 'archiveAll', labelId: 'L', userData: googleUserData })
        expect(gmailEmailLine.sweepLabel).toHaveBeenCalledWith('u', 'p1', 'L', 'archiveAll')
    })

    test('performEmailLineAction rejects unknown and unconnected', async () => {
        await expect(performEmailLineAction('u', 'p1', { action: 'nope', userData: googleUserData })).rejects.toThrow(
            /Unsupported/
        )
        await expect(
            performEmailLineAction('u', 'p1', { action: 'archive', messageIds: [], userData: {} })
        ).rejects.toMatchObject({ code: 'EMAIL_AUTH_EXPIRED' })
    })

    test('performEmailLineAction sweep requires labelId', async () => {
        await expect(
            performEmailLineAction('u', 'p1', { action: 'markAllRead', userData: googleUserData })
        ).rejects.toThrow(/labelId is required/)
    })

    test('draftReply composes, charges gold, and creates a Gmail draft', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', from: 'a@ex.com', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: true, amount: 5 })
        createGmailReplyDraftForAssistantRequest.mockResolvedValue({
            success: true,
            webUrl: 'https://mail/draft',
            targetSubject: 'Re: Hi',
        })
        const userData = {
            ...googleUserData,
            defaultProjectId: 'p1',
            displayName: 'Anna',
            extendedDescription: 'Prefers concise replies.',
            projectIds: ['p1'],
        }
        mockDocs.set('projects/p1', {
            name: 'Client launch',
            description: 'Launching the new site.',
            usersData: { u: { extendedDescription: 'Handles stakeholder updates.' } },
        })

        const result = await performEmailLineAction('u', 'p1', {
            action: 'draftReply',
            messageIds: ['m1'],
            guidance: 'be brief',
            sourceProjectId: 'p1',
            sourceTaskId: 'task-1',
            userData,
        })

        expect(composeReply).toHaveBeenCalledWith(
            expect.objectContaining({
                guidance: 'be brief',
                context: expect.objectContaining({ subject: 'Hi' }),
                groundingContext: expect.objectContaining({
                    userName: 'Anna',
                    globalUserDescription: 'Prefers concise replies.',
                    projectName: 'Client launch',
                    projectUserDescription: 'Handles stakeholder updates.',
                    projectDescription: 'Launching the new site.',
                }),
            })
        )
        expect(deductGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_draft_reply', projectId: 'p1', objectId: 'm1', channel: 'google' })
        )
        expect(createGmailReplyDraftForAssistantRequest).toHaveBeenCalledWith({
            userId: 'u',
            messageId: 'm1',
            body: 'Sure',
        })
        expect(mockTaskCommentServiceAddComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'p1',
                taskId: 'task-1',
                comment: 'I created a draft reply for this email: https://mail/draft',
                actor: expect.objectContaining({ uid: 'assistant-1' }),
                fromAssistant: true,
                silent: true,
            })
        )
        expect(result).toEqual({
            draftUrl: 'https://mail/draft',
            subject: 'Re: Hi',
            goldCost: 5,
            commentId: 'draft-comment-1',
        })
        expect(refundGold).not.toHaveBeenCalled()
    })

    test('draftReply throws on insufficient gold and does not create a draft', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: false })

        await expect(
            performEmailLineAction('u', 'p1', { action: 'draftReply', messageIds: ['m1'], userData: googleUserData })
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_GOLD' })
        expect(createGmailReplyDraftForAssistantRequest).not.toHaveBeenCalled()
    })

    test('draftReply refunds gold when draft creation fails', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', body: 'Q?' })
        composeReply.mockResolvedValue({ body: 'Sure', totalTokens: 200 })
        deductGold.mockResolvedValue({ success: true, amount: 5 })
        createGmailReplyDraftForAssistantRequest.mockResolvedValue({ success: false, message: 'boom' })

        await expect(
            performEmailLineAction('u', 'p1', { action: 'draftReply', messageIds: ['m1'], userData: googleUserData })
        ).rejects.toThrow(/boom/)
        expect(refundGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_draft_reply', note: 'draft creation failed' })
        )
    })

    test('summary builds needs-reply flags from audit records intersected with unread inbox ids', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 2, kind: 'inbox' }],
        })
        mockDocs.set('labelingConfig', {
            enabled: true,
            labelDefinitions: [
                { key: 'ads', gmailLabelName: 'Ads' },
                { key: 'project_juno', gmailLabelName: 'JTL Software - Project Juno' },
            ],
        })
        mockAuditDocs.set('m1', { needsReply: true })
        mockAuditDocs.set('m2', { needsReply: false })
        mockAuditDocs.set('m3', { needsReply: true }) // flagged but no longer unread
        gmailEmailLine.getUnreadInboxMessageIds.mockResolvedValue(['m1', 'm2'])

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(summary.needsReplyByMessageId).toEqual({ m1: true })
        expect(summary.needsReplyCount).toBe(1)
        expect(summary.labelingEnabled).toBe(true)
        expect(summary.labelOptions).toEqual([
            { gmailLabelName: 'Ads', displayName: 'Ads' },
            { gmailLabelName: 'JTL Software - Project Juno', displayName: 'JTL Software - Project Juno' },
        ])
        // No separate detector, no gold charge.
        expect(deductGold).not.toHaveBeenCalled()
    })

    test('summary keeps audit flags when the unread-ids lookup fails', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', unreadCount: 1, kind: 'inbox' }],
        })
        mockAuditDocs.set('m1', { needsReply: true })
        gmailEmailLine.getUnreadInboxMessageIds.mockRejectedValue(new Error('quota'))

        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData, includeNeedsReply: true })
        expect(summary.needsReplyByMessageId).toEqual({ m1: true })
    })

    test('summary skips needs-reply flags for Microsoft connections', async () => {
        microsoftEmailLine.getMicrosoftLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'f_inbox', unreadCount: 1, kind: 'inbox' }],
            emailAddress: 'me@outlook.com',
        })
        mockAuditDocs.set('m1', { needsReply: true })

        const summary = await getEmailLineSummary('u', 'p1', { userData: microsoftUserData, includeNeedsReply: true })
        expect(summary.needsReplyByMessageId).toEqual({})
        expect(gmailEmailLine.getUnreadInboxMessageIds).not.toHaveBeenCalled()
    })

    test('createTask summarizes the email, charges gold, and creates a follow-up-format task', async () => {
        const userData = {
            ...googleUserData,
            projectIds: ['p1', 'proj_target'],
        }
        gmailEmailLine.getMessageContext.mockResolvedValue({
            subject: 'Invoice 42',
            from: 'bob@ex.com',
            body: 'Please pay invoice 42',
            threadId: 'th1',
        })
        mockAuditDocs.set('m1', {
            selectedProjectId: 'proj_target',
            gmailThreadId: 'th1',
            selectedLabelKey: 'project_target',
            reasoning: 'Invoice for the target project.',
            confidence: 0.8,
        })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Pay invoice 42 from Bob', totalTokens: 120 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockResolvedValue({ success: true, taskId: 't1' })

        const result = await performEmailLineAction('u', 'p1', {
            action: 'createTask',
            messageIds: ['m1'],
            userData,
        })

        expect(deductGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({
                source: 'email_create_task',
                projectId: 'proj_target',
                objectId: 'm1',
                channel: 'google',
            })
        )
        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Pay invoice 42 from Bob',
                projectId: 'proj_target',
                gmailData: expect.objectContaining({
                    origin: 'gmail_label_follow_up',
                    messageId: 'm1',
                    gmailEmail: 'me@gmail.com',
                    selectedProjectId: 'proj_target',
                    webUrl: 'https://gmail/message',
                    archiveOnComplete: true,
                }),
            }),
            expect.objectContaining({ projectId: 'proj_target' })
        )
        expect(result).toEqual({
            taskId: 't1',
            projectId: 'proj_target',
            taskName: 'Pay invoice 42 from Bob',
            goldCost: 5,
        })
        expect(refundGold).not.toHaveBeenCalled()

        // Routing reasoning is posted as a comment on the created task…
        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_target',
                taskId: 't1',
                reasoning: 'Invoice for the target project.',
                confidence: 0.8,
                matched: true,
                source: 'email_line_create_task',
                routingKey: 'm1',
                sourceDataField: 'gmailData',
            })
        )
        // …and the audit record remembers the created task for future modal opens.
        expect(mockAuditDocs.get('m1').taskCreated).toEqual(
            expect.objectContaining({ taskId: 't1', projectId: 'proj_target', taskName: 'Pay invoice 42 from Bob' })
        )
    })

    test('createTask without an audit match explains the default-project fallback', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', from: 'a@ex.com', body: 'b' })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Do the thing', totalTokens: 50 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockResolvedValue({ success: true, taskId: 't2' })

        await performEmailLineAction('u', 'p1', {
            action: 'createTask',
            messageIds: ['m1'],
            userData: googleUserData,
        })

        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'p1',
                taskId: 't2',
                matched: false,
                reasoning: 'it is the default project for me@gmail.com',
                confidence: null,
            })
        )
        expect(mockAuditDocs.get('m1').taskCreated).toEqual(expect.objectContaining({ taskId: 't2' }))
    })

    test('createTask uses the current configured label project when no audit project was stamped', async () => {
        const userData = {
            ...googleUserData,
            projectIds: ['p1', 'proj_client'],
        }
        mockDocs.set('labelingConfig', {
            labelDefinitions: [
                {
                    key: 'project_client',
                    gmailLabelName: 'Client Project',
                    sourceProjectId: 'proj_client',
                },
            ],
        })
        gmailEmailLine.getMessageContext.mockResolvedValue({
            subject: 'Client request',
            from: 'client@ex.com',
            body: 'Please handle this',
            threadId: 'th1',
        })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Handle client request', totalTokens: 50 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockResolvedValue({ success: true, taskId: 't_label' })

        const result = await performEmailLineAction('u', 'p1', {
            action: 'createTask',
            messageIds: ['m1'],
            labelName: 'Client Project',
            userData,
        })

        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_client',
                gmailData: expect.objectContaining({
                    selectedProjectId: 'proj_client',
                    taskProjectId: 'proj_client',
                }),
            }),
            expect.objectContaining({ projectId: 'proj_client' })
        )
        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_client',
                taskId: 't_label',
                matched: true,
                reasoning: 'The email is in the Client Project Gmail label.',
                routingData: expect.objectContaining({
                    selectedLabelKey: 'project_client',
                    selectedProjectId: 'proj_client',
                }),
            })
        )
        expect(result).toEqual(expect.objectContaining({ taskId: 't_label', projectId: 'proj_client' }))
    })

    test('createTask chooses the audited message from a thread row for project reasoning', async () => {
        const userData = {
            ...googleUserData,
            projectIds: ['p1', 'proj_target'],
        }
        gmailEmailLine.getMessageContext.mockResolvedValue({
            subject: 'Project update',
            from: 'bob@ex.com',
            body: 'Target project update',
            threadId: 'th1',
        })
        mockAuditDocs.set('m_audit', {
            selectedProjectId: 'proj_target',
            gmailThreadId: 'th1',
            selectedLabelKey: 'project_target',
            reasoning: 'This thread is about the target project.',
            confidence: 0.7,
        })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Review project update', totalTokens: 50 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockResolvedValue({ success: true, taskId: 't3' })

        await performEmailLineAction('u', 'p1', {
            action: 'createTask',
            messageIds: ['m_visible', 'm_audit'],
            userData,
        })

        expect(gmailEmailLine.getMessageContext).toHaveBeenCalledWith('u', 'p1', 'm_audit')
        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_target',
                gmailData: expect.objectContaining({
                    messageId: 'm_audit',
                    messageIds: ['m_visible', 'm_audit'],
                    selectedProjectId: 'proj_target',
                }),
            }),
            expect.anything()
        )
        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_target',
                taskId: 't3',
                reasoning: 'This thread is about the target project.',
                routingKey: 'm_audit',
                routingData: expect.objectContaining({
                    messageId: 'm_audit',
                    messageIds: ['m_visible', 'm_audit'],
                }),
            })
        )
        expect(mockAuditDocs.get('m_audit').taskCreated).toEqual(expect.objectContaining({ taskId: 't3' }))
    })

    test('createTask finds legacy project-keyed audit when called with a connection id', async () => {
        const userData = {
            ...googleConnectionUserData,
            projectIds: ['p1', 'proj_target'],
        }
        gmailEmailLine.getMessageContext.mockResolvedValue({
            subject: 'Project update',
            from: 'bob@ex.com',
            body: 'Target project update',
            threadId: 'th1',
        })
        mockAuditDocs.set('audit:p1:m_audit', {
            selectedProjectId: 'proj_target',
            gmailThreadId: 'th1',
            selectedLabelKey: 'project_target',
            reasoning: 'Legacy audit says this belongs to the target project.',
            confidence: 0.77,
        })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Review project update', totalTokens: 50 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockResolvedValue({ success: true, taskId: 't4' })

        await performEmailLineAction('u', 'email_google_test', {
            action: 'createTask',
            messageIds: ['m_visible', 'm_audit'],
            userData,
        })

        expect(gmailEmailLine.getMessageContext).toHaveBeenCalledWith('u', 'email_google_test', 'm_audit')
        expect(mockAddProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj_target',
                taskId: 't4',
                reasoning: 'Legacy audit says this belongs to the target project.',
                confidence: 0.77,
                routingKey: 'm_audit',
            })
        )
        expect(mockAuditDocs.get('audit:p1:m_audit').taskCreated).toEqual(expect.objectContaining({ taskId: 't4' }))
    })

    test('createTask falls back to the connection project and refunds gold on failure', async () => {
        gmailEmailLine.getMessageContext.mockResolvedValue({ subject: 'Hi', from: 'a@ex.com', body: 'b' })
        summarizeEmailAsTaskName.mockResolvedValue({ name: 'Do the thing', totalTokens: 50 })
        deductGold.mockResolvedValue({ success: true })
        mockCreateAndPersistTask.mockRejectedValue(new Error('boom'))

        await expect(
            performEmailLineAction('u', 'p1', { action: 'createTask', messageIds: ['m1'], userData: googleUserData })
        ).rejects.toThrow(/boom/)
        expect(deductGold).toHaveBeenCalledWith('u', 5, expect.objectContaining({ projectId: 'p1' }))
        expect(refundGold).toHaveBeenCalledWith(
            'u',
            5,
            expect.objectContaining({ source: 'email_create_task', note: 'task creation failed' })
        )
        expect(mockAddProjectRoutingReasonComment).not.toHaveBeenCalled()
        expect(mockAuditDocs.get('m1')).toBeUndefined()
    })

    test('listEmailLineMessages joins labeling audit data onto rows', async () => {
        mockAuditDocs.set('m1', {
            followUpType: 'informational',
            selectedLabelKey: 'newsletter',
            selectedGmailLabelName: 'Alldone/Newsletter',
            reasoning: 'Weekly digest the user subscribed to.',
            confidence: 0.92,
            taskCreated: { taskId: 't9', projectId: 'p9', taskName: 'Read digest', at: 1 },
        })
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({
            messages: [
                { messageId: 'm_visible', messageIds: ['m_visible', 'm1'], subject: 'Q?' },
                { messageId: 'm2', subject: 'FYI' },
            ],
            nextPageToken: null,
        })

        const result = await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData })
        const first = result.messages.find(m => m.messageId === 'm_visible')
        expect(first.followUpType).toBe('informational')
        expect(first.hasAudit).toBe(true)
        expect(first.auditMessageId).toBe('m1')
        expect(first.labelName).toBe('Alldone/Newsletter')
        expect(first.reasoning).toBe('Weekly digest the user subscribed to.')
        expect(first.confidence).toBe(0.92)
        // Live tasks are authoritative for the indicator: a stale audit `taskCreated`
        // stamp with no matching task in the collection is ignored (self-heals on delete).
        expect(first.taskCreated).toBeNull()
        const second = result.messages.find(m => m.messageId === 'm2')
        expect(second.followUpType).toBeNull()
        expect(second.hasAudit).toBe(false)
        expect(second.reasoning).toBe('')
        expect(second.taskCreated).toBeNull()
    })

    test('listEmailLineMessages marks a row from a live task (matched on any thread message id)', async () => {
        // Task lives in the connection's project, keyed on a non-primary thread message id.
        mockTaskDocs.set('items/p1/tasks', [
            {
                id: 'task-live',
                data: { name: 'Reply to the digest', gmailData: { messageId: 'm1', gmailEmail: 'me@gmail.com' } },
            },
        ])
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({
            messages: [{ messageId: 'm_visible', messageIds: ['m_visible', 'm1'], subject: 'Q?' }],
            nextPageToken: null,
        })

        const result = await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData })

        expect(result.messages[0].taskCreated).toEqual({
            taskId: 'task-live',
            projectId: 'p1',
            taskName: 'Reply to the digest',
        })
    })

    test('listEmailLineMessages ignores a live task from a different email account', async () => {
        mockTaskDocs.set('items/p1/tasks', [
            {
                id: 'task-other',
                data: { name: 'Other inbox', gmailData: { messageId: 'm1', gmailEmail: 'other@gmail.com' } },
            },
        ])
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({
            messages: [{ messageId: 'm_visible', messageIds: ['m_visible', 'm1'], subject: 'Q?' }],
            nextPageToken: null,
        })

        const result = await listEmailLineMessages('u', 'p1', 'INBOX', { userData: googleUserData })

        expect(result.messages[0].taskCreated).toBeNull()
    })

    test('listEmailLineMessages reads legacy project-keyed audit for connection-keyed email line', async () => {
        mockAuditDocs.set('audit:p1:m1', {
            needsReply: true,
            selectedLabelKey: 'ads',
            selectedGmailLabelName: 'Ads',
            reasoning: 'Legacy audit says this is promotional.',
            confidence: 0.91,
        })
        gmailEmailLine.listMessagesForLabel.mockResolvedValue({
            messages: [{ messageId: 'm_visible', messageIds: ['m_visible', 'm1'], subject: 'Promo' }],
            nextPageToken: null,
        })

        const result = await listEmailLineMessages('u', 'email_google_test', 'Ads', {
            userData: googleConnectionUserData,
        })

        expect(result.messages[0]).toEqual(
            expect.objectContaining({
                auditMessageId: 'm1',
                hasAudit: true,
                labelName: 'Ads',
                reasoning: 'Legacy audit says this is promotional.',
                confidence: 0.91,
            })
        )
    })

    test('inboxZero uses thread counts when present', async () => {
        gmailEmailLine.getGmailLabelSummary.mockResolvedValue({
            labels: [{ labelId: 'INBOX', threadCount: 2, unreadCount: 0, kind: 'inbox' }],
        })
        const summary = await getEmailLineSummary('u', 'p1', { userData: googleUserData })
        expect(summary.inboxZero).toBe(false)
    })
})
