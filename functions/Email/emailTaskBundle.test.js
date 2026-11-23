// AT-3135: email follow-ups of one source and handling context are collected in one to-do.
// Real TaskService + TaskCommentService on the transactional in-memory Firestore; only the
// summary model, Gold and follower notifications are stubbed.
jest.mock('./emailLine/taskSummarizer', () => ({ summarizeEmailContinuation: jest.fn() }))
jest.mock('../Assistant/assistantHelper', () => ({ calculateGoldCostFromTokens: jest.fn(() => 2) }))
jest.mock('../Assistant/assistantModelRuntime', () => jest.requireMock('../Assistant/assistantHelper'))
jest.mock('../Gold/goldHelper', () => ({ deductGold: jest.fn(async () => ({ success: true })) }))
jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: () => 'unused' }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ FEED_PUBLIC_FOR_ALL: 0, STAYWARD_COMMENT: 2 }))

const { TaskService } = require('../shared/TaskService')
const { TaskCommentService } = require('../shared/TaskCommentService')
const { createEmailDatabase } = require('./__fixtures__/emailDatabase')
const { getEmailIdentity } = require('./emailThreadIdentity')
const { continueEmailThread } = require('./emailThreadContinuation')
const { summarizeEmailContinuation } = require('./emailLine/taskSummarizer')
const { deductGold } = require('../Gold/goldHelper')
const {
    appendEmailToBundleTask,
    buildEmailBundleItemLine,
    buildEmailBundleTitle,
    getEmailSenderDomain,
    listEmailBundlesForSender,
    normalizeEmailBundleProposal,
    resolveEmailBundle,
    shouldBundleCreateTask,
} = require('./emailTaskBundle')

const KLEINANZEIGEN = '"Layla über Kleinanzeigen" <noreply@mail.kleinanzeigen.de>'
const PROPOSAL = { key: 'buyer-inquiries', label: 'Kleinanzeigen' }
const PROJECTS = ['privat', 'familie']

const mail = (messageId, threadId, extra = {}) => ({
    provider: 'google',
    accountUserId: 'u',
    gmailEmail: 'me@example.com',
    origin: 'gmail_label_follow_up',
    messageId,
    threadId,
    webUrl: `https://mail.google.com/mail/u/0/#all/${messageId}`,
    receivedAt: 0,
    ...extra,
})
const context = (from = KLEINANZEIGEN, date = '2026-11-23T10:00:00Z') => ({
    from,
    date,
    subject: 'Nutzer-Anfrage zu deiner Anzeige',
    snippet: 'Hallo, ist das noch da?',
})

let nextId = 0
let database
const taskService = () =>
    new TaskService({ database, enableFeeds: false, enableValidation: false, idGenerator: () => `t${++nextId}` })

// What create_task does for a Gmail follow-up with emailBundle (assistantHelper.js).
async function createFromEmail({
    messageId,
    threadId,
    name,
    projectId = 'privat',
    from = KLEINANZEIGEN,
    projectIds = PROJECTS,
    proposal = PROPOSAL,
}) {
    const gmailData = mail(messageId, threadId)
    const bundle = resolveEmailBundle({ identity: getEmailIdentity('u', gmailData), from, proposal })
    const result = await taskService().createAndPersistTask(
        {
            name: buildEmailBundleTitle(bundle.label, name),
            description: buildEmailBundleItemLine({ text: name, webUrl: gmailData.webUrl }),
            userId: 'u',
            projectId,
            isPrivate: true,
            creatorId: 'assistant',
            gmailData: {
                ...gmailData,
                threadIds: [threadId],
                bundle: {
                    id: bundle.id,
                    key: bundle.key,
                    label: bundle.label,
                    senderDomain: bundle.senderDomain,
                    itemCount: 1,
                },
            },
        },
        {},
        { emailThread: { userId: 'u', projectIds, bundle } }
    )
    if (result.existing && result.bundleExisting) {
        return appendEmailToBundleTask({
            database,
            userId: 'u',
            projectIds,
            selected: { taskId: result.taskId, projectId: result.projectId, task: result.task },
            bundleId: bundle.id,
            gmailData,
            context: context(from),
            itemText: name,
            state: name,
            actor: { uid: 'assistant', displayName: 'Anna', fromAssistant: true },
        })
    }
    return result
}

const tasks = () => [...database.docs.entries()].filter(([path]) => path.startsWith('items/'))
const onlyTask = () => {
    const all = tasks()
    expect(all).toHaveLength(1)
    return all[0][1]
}
const comments = () => [...database.docs.keys()].filter(path => path.startsWith('chatComments/'))

beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(TaskCommentService.prototype, 'notifyFollowers').mockResolvedValue(1)
    database = createEmailDatabase()
})
afterEach(() => jest.restoreAllMocks())

describe('identity of a collection to-do', () => {
    test('the source is the registrable sender domain from the From header', () => {
        expect(getEmailSenderDomain(KLEINANZEIGEN)).toBe('kleinanzeigen.de')
        expect(getEmailSenderDomain('noreply@kleinanzeigen.de')).toBe('kleinanzeigen.de')
        expect(getEmailSenderDomain('Shop <orders@mail.shop.co.uk>')).toBe('shop.co.uk')
        expect(getEmailSenderDomain('no address')).toBe('')
    })

    test('the model only names the context; key and label are normalized and bounded', () => {
        expect(normalizeEmailBundleProposal({ key: ' Käufer Anfragen! ', label: 'Kleinanzeigen: ' })).toEqual({
            key: 'kaufer-anfragen',
            label: 'Kleinanzeigen',
        })
        expect(normalizeEmailBundleProposal({ key: '', label: 'X' })).toBeNull()
        expect(normalizeEmailBundleProposal({ key: 'a-b', label: '   ' })).toBeNull()
        expect(normalizeEmailBundleProposal(null)).toBeNull()
    })

    test('mailbox, sender domain and context each separate collection to-dos', () => {
        const identity = getEmailIdentity('u', mail('m', 't'))
        const base = resolveEmailBundle({ identity, from: KLEINANZEIGEN, proposal: PROPOSAL })
        expect(resolveEmailBundle({ identity, from: 'noreply@kleinanzeigen.de', proposal: PROPOSAL }).id).toBe(base.id)
        expect(resolveEmailBundle({ identity, from: 'noreply@ebay.de', proposal: PROPOSAL }).id).not.toBe(base.id)
        expect(
            resolveEmailBundle({ identity, from: KLEINANZEIGEN, proposal: { key: 'account', label: 'Kleinanzeigen' } })
                .id
        ).not.toBe(base.id)
        const otherMailbox = getEmailIdentity('u', mail('m', 't', { gmailEmail: 'other@example.com' }))
        expect(resolveEmailBundle({ identity: otherMailbox, from: KLEINANZEIGEN, proposal: PROPOSAL }).id).not.toBe(
            base.id
        )
        const otherUser = getEmailIdentity('v', mail('m', 't'))
        expect(resolveEmailBundle({ identity: otherUser, from: KLEINANZEIGEN, proposal: PROPOSAL }).id).not.toBe(
            base.id
        )
        expect(resolveEmailBundle({ identity, from: 'not an address', proposal: PROPOSAL })).toBeNull()
    })

    test('a task with its own deadline or reminder is separately urgent and not collected', () => {
        expect(shouldBundleCreateTask({ name: 'x' })).toBe(true)
        expect(shouldBundleCreateTask({ name: 'x', dueDate: '2026-11-24T10:00:00' })).toBe(false)
        expect(shouldBundleCreateTask({ name: 'x', alertEnabled: true })).toBe(false)
    })

    test('the title is "<label>: <state>" and never doubles the label', () => {
        expect(buildEmailBundleTitle('Kleinanzeigen', 'Layla möchte ein Foto')).toBe(
            'Kleinanzeigen: Layla möchte ein Foto'
        )
        expect(buildEmailBundleTitle('Kleinanzeigen', 'Kleinanzeigen: Layla möchte ein Foto')).toBe(
            'Kleinanzeigen: Layla möchte ein Foto'
        )
    })
})

describe('collecting emails of several threads in one to-do', () => {
    test('a second thread is appended to the first email’s to-do instead of creating a task', async () => {
        const first = await createFromEmail({
            messageId: 'm1',
            threadId: 'T1',
            name: 'Layla möchte ein Foto der Wickelkommode',
        })
        expect(first.existing).toBe(false)
        const second = await createFromEmail({
            messageId: 'm2',
            threadId: 'T2',
            name: 'AS fragt nach Abholung der Wandregale',
        })
        expect(second).toMatchObject({ taskId: first.taskId, projectId: 'privat', bundled: true, updated: true })

        const task = onlyTask()
        expect(task.name).toBe('Kleinanzeigen: AS fragt nach Abholung der Wandregale')
        expect(task.extendedName).toBe(task.name)
        expect(task.description).toBe(
            '- Layla möchte ein Foto der Wickelkommode https://mail.google.com/mail/u/0/#all/m1\n' +
                '- AS fragt nach Abholung der Wandregale https://mail.google.com/mail/u/0/#all/m2'
        )
        expect(task.isPrivate).toBe(true)
        expect(task.messageData == null).toBe(true)
        expect(task.gmailData.messageIds).toEqual(['m1', 'm2'])
        expect(task.gmailData.threadIds).toEqual(['T1', 'T2'])
        expect(task.gmailData.bundle).toMatchObject({ key: 'buyer-inquiries', label: 'Kleinanzeigen', itemCount: 2 })
        const comment = database.docs.get(comments()[0])
        expect(comment.gmailData).toMatchObject({ messageId: 'm2', threadId: 'T2', taskProjectId: 'privat' })
        expect(comment.commentText).toContain('AS fragt nach Abholung der Wandregale')
        expect(TaskCommentService.prototype.notifyFollowers).toHaveBeenCalledTimes(1)
    })

    test('processing the same email again changes nothing', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt nach Abholung' })
        const before = JSON.stringify(onlyTask())
        const again = await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt nach Abholung' })
        expect(again.existing).toBe(true)
        expect(JSON.stringify(onlyTask())).toBe(before)
        expect(comments()).toHaveLength(1)
        // The first email again: its thread task is the collection to-do, nothing is added.
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        expect(JSON.stringify(onlyTask())).toBe(before)
    })

    test('two emails of one context racing create one to-do', async () => {
        const results = await Promise.all([
            createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' }),
            createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Zweite Anfrage' }),
        ])
        expect(results[0].taskId).toBe(results[1].taskId)
        expect(onlyTask().gmailData.messageIds.sort()).toEqual(['m1', 'm2'])
    })

    test('another sender domain or another context gets its own to-do', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Käufer fragt', from: 'eBay <noreply@ebay.de>' })
        await createFromEmail({
            messageId: 'm3',
            threadId: 'T3',
            name: 'Konto prüfen',
            proposal: { key: 'account-security', label: 'Kleinanzeigen-Konto' },
        })
        expect(tasks()).toHaveLength(3)
    })

    test('the to-do stays in its first project even when a later email is routed elsewhere', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        const second = await createFromEmail({
            messageId: 'm2',
            threadId: 'T2',
            name: 'Abholung',
            projectId: 'familie',
        })
        expect(second).toMatchObject({ taskId: first.taskId, projectId: 'privat' })
        expect(onlyTask().gmailData.messageIds).toEqual(['m1', 'm2'])
    })

    test('a to-do in a project the user left, or a deleted one, is not reused', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' })
        const second = await createFromEmail({
            messageId: 'm2',
            threadId: 'T2',
            name: 'Zweite Anfrage',
            projectId: 'familie',
            projectIds: ['familie'],
        })
        expect(second.existing).toBe(false)
        expect(second.taskId).not.toBe(first.taskId)
        expect(second.projectId).toBe('familie')
        // The registry now points at the new to-do; deleting it starts another one.
        database.docs.delete(`items/familie/tasks/${second.taskId}`)
        const third = await createFromEmail({
            messageId: 'm3',
            threadId: 'T3',
            name: 'Dritte Anfrage',
            projectId: 'familie',
            projectIds: ['familie'],
        })
        expect(third.existing).toBe(false)
        expect(third.taskId).not.toBe(second.taskId)
    })

    test('a to-do that is no longer the owner’s is not reused', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' })
        const path = `items/privat/tasks/${first.taskId}`
        database.docs.set(path, { ...database.docs.get(path), isPublicFor: ['someone-else'] })
        const second = await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Zweite Anfrage' })
        expect(second.taskId).not.toBe(first.taskId)
    })

    test('the user’s own title and description edits are kept; new lines are still added', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        const path = `items/privat/tasks/${first.taskId}`
        const task = database.docs.get(path)
        database.docs.set(path, {
            ...task,
            name: 'Kleinanzeigen-Verkäufe',
            extendedName: 'Kleinanzeigen-Verkäufe',
            description: `Meine Notiz\n${task.description}`,
        })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt nach Abholung' })
        const updated = onlyTask()
        expect(updated.name).toBe('Kleinanzeigen-Verkäufe')
        expect(updated.description).toBe(
            'Meine Notiz\n- Layla möchte ein Foto https://mail.google.com/mail/u/0/#all/m1\n' +
                '- AS fragt nach Abholung https://mail.google.com/mail/u/0/#all/m2'
        )
    })

    test('the model sees the existing contexts of this sender and mailbox only', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Käufer fragt', from: 'eBay <noreply@ebay.de>' })
        const identity = getEmailIdentity('u', mail('m9', 'T9'))
        expect(await listEmailBundlesForSender({ database, identity, from: 'noreply@kleinanzeigen.de' })).toEqual([
            { key: 'buyer-inquiries', label: 'Kleinanzeigen' },
        ])
        const otherMailbox = getEmailIdentity('u', mail('m9', 'T9', { gmailEmail: 'other@example.com' }))
        expect(await listEmailBundlesForSender({ database, identity: otherMailbox, from: KLEINANZEIGEN })).toEqual([])
    })
})

describe('lifecycle once the collection to-do is done', () => {
    const markDone = taskId => {
        const path = `items/privat/tasks/${taskId}`
        database.docs.set(path, { ...database.docs.get(path), done: true, inDone: true, completed: 123 })
    }

    test('the next actionable email reopens the done to-do and adds its line', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        markDone(first.taskId)
        const second = await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Neue Anfrage zum Regal' })
        expect(second.taskId).toBe(first.taskId)
        expect(onlyTask()).toMatchObject({
            done: false,
            inDone: false,
            completed: null,
            name: 'Kleinanzeigen: Neue Anfrage zum Regal',
        })
        expect(onlyTask().description).toContain('- Neue Anfrage zum Regal')
    })

    test('an informational email of a collected thread is a silent comment and keeps it done', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt nach Abholung' })
        markDone(first.taskId)
        const before = onlyTask()
        summarizeEmailContinuation.mockResolvedValue({
            totalTokens: 10,
            modelKey: 'MODEL_GPT5_4_NANO',
            plan: { summary: 'AS bedankt sich.', state: 'AS hat sich bedankt' },
        })
        const result = await continueEmailThread({
            database,
            userId: 'u',
            userData: { projectIds: PROJECTS },
            gmailData: mail('m3', 'T2'),
            context: context(),
            actor: { uid: 'assistant', fromAssistant: true },
            reopenOnNewEmail: false,
        })
        expect(result).toMatchObject({ taskId: first.taskId, bundled: true, updated: true })
        const task = onlyTask()
        expect(task).toMatchObject({ done: true, inDone: true, name: before.name, description: before.description })
        expect(task.gmailData.messageIds).toContain('m3')
        expect(task.gmailData.bundle.itemCount).toBe(2)
        expect(TaskCommentService.prototype.notifyFollowers).toHaveBeenCalledTimes(1) // only m2's line
    })
})

describe('later email of a thread that is in the collection to-do (AT-2709 continuation)', () => {
    beforeEach(() => {
        summarizeEmailContinuation.mockResolvedValue({
            totalTokens: 100,
            modelKey: 'MODEL_GPT5_4_NANO',
            plan: {
                summary: 'AS schlägt Samstag 10 Uhr zur Abholung vor.',
                actionUpdate: 'Abholung Samstag bestätigen.',
                state: 'AS will Samstag um 10 abholen',
                name: 'ignored for collections',
            },
        })
    })

    test('a reply in a thread that joined later finds the to-do and moves its title to the thread state', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt nach Abholung' })
        const result = await continueEmailThread({
            database,
            userId: 'u',
            userData: { projectIds: PROJECTS, language: 'de' },
            gmailData: mail('m3', 'T2', { receivedAt: 5 }),
            context: context(),
            actor: { uid: 'assistant', fromAssistant: true },
            needsReply: true,
        })
        expect(result).toMatchObject({ taskId: first.taskId, projectId: 'privat', bundled: true, goldCost: 2 })
        expect(summarizeEmailContinuation).toHaveBeenCalledWith(expect.objectContaining({ bundle: true }))
        expect(deductGold).toHaveBeenCalledWith(
            'u',
            2,
            expect.objectContaining({ source: 'email_thread_continuation' })
        )
        const task = onlyTask()
        expect(task.name).toBe('Kleinanzeigen: AS will Samstag um 10 abholen')
        expect(task.description.split('\n')).toHaveLength(3)
        expect(task.description).toMatch(
            /- AS will Samstag um 10 abholen https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/m3$/
        )
        // A collection to-do never turns into one conversation's reply task.
        expect(task.messageData == null).toBe(true)
        expect(task.isPrivate).toBe(true)

        // Same email again: no second line, no second charge.
        jest.clearAllMocks()
        const again = await continueEmailThread({
            database,
            userId: 'u',
            userData: { projectIds: PROJECTS },
            gmailData: mail('m3', 'T2', { receivedAt: 5 }),
            context: context(),
            actor: { uid: 'assistant' },
        })
        expect(again.taskId).toBe(first.taskId)
        expect(summarizeEmailContinuation).not.toHaveBeenCalled()
        expect(deductGold).not.toHaveBeenCalled()
        expect(onlyTask().description.split('\n')).toHaveLength(3)
    })

    test('an older email does not move the title back', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        const path = tasks()[0][0]
        database.docs.set(path, {
            ...database.docs.get(path),
            gmailData: { ...database.docs.get(path).gmailData, lastEmailReceivedAt: 1000 },
        })
        await continueEmailThread({
            database,
            userId: 'u',
            userData: { projectIds: PROJECTS },
            gmailData: mail('m0', 'T1'),
            context: { ...context(), internalDate: '10' },
            actor: { uid: 'assistant' },
        })
        expect(onlyTask().name).toBe('Kleinanzeigen: Layla möchte ein Foto')
        expect(onlyTask().description).toContain('- AS will Samstag um 10 abholen')
    })

    test('the thread pointer is scoped to the owner’s projects', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Layla möchte ein Foto' })
        await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'AS fragt' })
        const result = await continueEmailThread({
            database,
            userId: 'u',
            userData: { projectIds: ['familie'] },
            gmailData: mail('m3', 'T2'),
            context: context(),
            actor: { uid: 'assistant' },
        })
        expect(result).toBeNull()
    })
})

describe('guards inside the comment transaction', () => {
    test('an email cannot be appended to a task of another collection or another mailbox', async () => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' })
        const selected = { taskId: first.taskId, projectId: 'privat' }
        const base = {
            database,
            userId: 'u',
            projectIds: PROJECTS,
            selected,
            context: context(),
            itemText: 'x',
            actor: { uid: 'assistant' },
        }
        const bundleId = onlyTask().gmailData.bundle.id
        await expect(
            appendEmailToBundleTask({ ...base, bundleId: 'other-collection', gmailData: mail('m2', 'T2') })
        ).rejects.toThrow('does not match the task account and collection')
        await expect(
            appendEmailToBundleTask({
                ...base,
                bundleId,
                gmailData: mail('m2', 'T2', { gmailEmail: 'other@example.com' }),
            })
        ).rejects.toThrow('does not match the task account and collection')
        // A project outside the caller's scope never resolves as the selection.
        await expect(
            appendEmailToBundleTask({ ...base, bundleId, projectIds: ['familie'], gmailData: mail('m2', 'T2') })
        ).rejects.toThrow('selection changed')
        expect(onlyTask().gmailData.messageIds).toEqual(['m1'])
        expect(comments()).toHaveLength(0)
    })
})

describe('review findings', () => {
    test.each([
        ['made visible to the project', task => ({ ...task, isPrivate: false, isPublicFor: [0, 'u'] })],
        ['handed to another member', task => ({ ...task, userId: 'daniela', isPublicFor: ['daniela', 'u'] })],
    ])('a collection to-do %s takes no new conversations', async (_, change) => {
        const first = await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' })
        const path = `items/privat/tasks/${first.taskId}`
        database.docs.set(path, change(database.docs.get(path)))
        const second = await createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Zweite Anfrage' })
        expect(second.existing).toBe(false)
        expect(second.taskId).not.toBe(first.taskId)
        expect(database.docs.get(path).gmailData.messageIds).toEqual(['m1'])
    })

    test('a thread joins the collection to-do atomically, so a concurrent email of it finds no gap', async () => {
        await createFromEmail({ messageId: 'm1', threadId: 'T1', name: 'Erste Anfrage' })
        // m2 (collected) and m3 (same new thread, created without a context) race.
        const plain = taskService().createAndPersistTask(
            { name: 'Separate', userId: 'u', projectId: 'privat', gmailData: mail('m3', 'T2') },
            {},
            { emailThread: { userId: 'u', projectIds: PROJECTS } }
        )
        const [collected, other] = await Promise.all([
            createFromEmail({ messageId: 'm2', threadId: 'T2', name: 'Zweite Anfrage' }),
            plain,
        ])
        // Whichever commits first owns thread T2; the other one sees it. Never two tasks for T2.
        expect(other.taskId).toBe(collected.taskId)
        const { findEmailThreadTasks } = require('./emailThreadTaskStore')
        const owners = await findEmailThreadTasks({
            database,
            identity: getEmailIdentity('u', mail('m4', 'T2')),
            projectIds: PROJECTS,
        })
        expect(owners.map(owner => owner.taskId)).toEqual([collected.taskId])
    })

    test('a thread that already has several tasks gets a separate task that is not a collection', async () => {
        const legacy = { name: 'Alt', userId: 'u', isPublicFor: ['u'], gmailData: mail('old', 'T5') }
        database = createEmailDatabase({ 'items/privat/tasks/a': legacy, 'items/familie/tasks/b': legacy })
        const result = await createFromEmail({ messageId: 'm5', threadId: 'T5', name: 'Neue Anfrage' })
        expect(result.existing).toBe(false)
        expect(['a', 'b']).not.toContain(result.taskId)
        expect(result.task.gmailData.bundle).toBeUndefined()
        const later = await createFromEmail({ messageId: 'm6', threadId: 'T6', name: 'Andere Anfrage' })
        expect(later.existing).toBe(false)
        expect(later.task.gmailData.bundle).toBeDefined()
    })
})
