'use strict'

// AT-3165: email tasks star their Gmail message while open. Gmail is a fake here: no real mailbox is
// ever touched. The fake records every messages.get / messages.modify so the tests can pin that only
// STARRED is changed (never INBOX: archiving stays a separate action) and only on the right message.

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const {
    starEmailOfCreatedTask,
    resumePendingTaskEmailStar,
    syncTaskEmailStarOnTaskUpdate,
    syncTaskEmailStarOnTaskDelete,
} = require('./gmailTaskStar')

function createFakeDatabase(initial = {}) {
    const docs = new Map(Object.entries(initial))
    const docRef = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => {
            const data = docs.get(path)
            return { exists: data !== undefined, id: path.split('/').pop(), data: () => data }
        },
        set: async (value, options) => {
            const previous = docs.get(path) || {}
            docs.set(path, options?.merge ? { ...previous, ...value } : value)
        },
        collection: name => collectionRef(`${path}/${name}`),
    })
    const collectionRef = path => ({
        doc: id => docRef(`${path}/${id}`),
        where: (field, op, value) => ({
            get: async () => {
                const matches = [...docs.entries()].filter(([docPath, data]) => {
                    const rest = docPath.slice(path.length + 1)
                    return docPath.startsWith(`${path}/`) && !rest.includes('/') && data?.[field] === value
                })
                const snapshotDocs = matches.map(([docPath, data]) => ({
                    id: docPath.split('/').pop(),
                    data: () => data,
                }))
                return { docs: snapshotDocs, forEach: callback => snapshotDocs.forEach(callback) }
            },
        }),
    })
    return {
        docs,
        doc: docRef,
        collection: collectionRef,
    }
}

function createFakeGmail({ starred = [], missing = [], failModify = [] } = {}) {
    const labels = new Map()
    starred.forEach(id => labels.set(id, new Set(['INBOX', 'STARRED'])))
    const calls = []
    const failures = [...failModify]
    const gmail = {
        users: {
            messages: {
                get: jest.fn(async ({ id }) => {
                    calls.push({ type: 'get', id })
                    if (missing.includes(id)) {
                        const error = new Error('Requested entity was not found.')
                        error.code = 404
                        throw error
                    }
                    return { data: { id, labelIds: [...(labels.get(id) || new Set(['INBOX', 'UNREAD']))] } }
                }),
                modify: jest.fn(async ({ id, requestBody }) => {
                    calls.push({ type: 'modify', id, requestBody })
                    if (failures.length) {
                        const error = failures.shift()
                        throw error
                    }
                    const current = labels.get(id) || new Set(['INBOX', 'UNREAD'])
                    ;(requestBody.addLabelIds || []).forEach(label => current.add(label))
                    ;(requestBody.removeLabelIds || []).forEach(label => current.delete(label))
                    labels.set(id, current)
                    return { data: { id, labelIds: [...current] } }
                }),
            },
        },
    }
    const withGmail = jest.fn(async (userId, connectionKey, run) => run(gmail))
    return { gmail, withGmail, calls, isStarred: id => !!labels.get(id)?.has('STARRED'), labels }
}

const OWNER = 'owner-1'
const CONNECTION = 'email_google_owner'
const emailTask = (overrides = {}) => ({
    inDone: false,
    userId: OWNER,
    userIds: [OWNER],
    gmailData: {
        origin: 'gmail_label_follow_up',
        provider: 'google',
        accountUserId: OWNER,
        messageId: 'm1',
        connectionId: CONNECTION,
    },
    ...overrides,
})

async function createStarredTask({ db, mail, taskId = 't1', projectId = 'p1', messageId = 'm1' }) {
    db.docs.set(`items/${projectId}/tasks/${taskId}`, emailTask({ gmailData: { ...emailTask().gmailData, messageId } }))
    return starEmailOfCreatedTask(
        { userId: OWNER, connectionKey: CONNECTION, gmailEmail: 'Owner@Gmail.com', messageId, projectId, taskId },
        { database: db, withGmail: mail.withGmail }
    )
}

describe('gmailTaskStar (AT-3165)', () => {
    describe('star when the task is created', () => {
        it('stars exactly the linked message of the mailbox the task came from', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            const result = await createStarredTask({ db, mail })

            expect(result.state).toBe('starred')
            expect(mail.withGmail).toHaveBeenCalledWith(OWNER, CONNECTION, expect.any(Function))
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([
                { type: 'modify', id: 'm1', requestBody: { addLabelIds: ['STARRED'] } },
            ])
            expect(mail.isStarred('m1')).toBe(true)
            expect(db.docs.get(`users/${OWNER}/gmailTaskStars/t1`)).toMatchObject({
                taskId: 't1',
                projectId: 'p1',
                connectionKey: CONNECTION,
                gmailEmail: 'owner@gmail.com',
                messageId: 'm1',
                wasStarredBefore: false,
                state: 'starred',
            })
        })

        it('is idempotent: a second call for the same task does not touch Gmail again', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            mail.calls.length = 0

            const again = await createStarredTask({ db, mail })
            expect(again).toEqual({ state: 'starred', reused: true })
            expect(mail.calls).toEqual([])
        })

        it('records a star the user set before as theirs and never adds or removes it', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail({ starred: ['m1'] })
            const result = await createStarredTask({ db, mail })

            expect(result.state).toBe('preexisting')
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([])

            const after = { ...emailTask(), inDone: true }
            const done = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: emailTask(), after },
                { database: db, withGmail: mail.withGmail }
            )
            expect(done.action).toBe('none')
            expect(mail.isStarred('m1')).toBe(true)
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([])
        })

        it('skips Outlook tasks and calls without a task or message', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            const options = { database: db, withGmail: mail.withGmail }
            expect(
                await starEmailOfCreatedTask(
                    { userId: OWNER, connectionKey: CONNECTION, messageId: 'm1', taskId: 't1', provider: 'microsoft' },
                    options
                )
            ).toMatchObject({ state: 'skipped' })
            expect(
                await starEmailOfCreatedTask(
                    { userId: OWNER, connectionKey: CONNECTION, messageId: '', taskId: 't1' },
                    options
                )
            ).toMatchObject({ state: 'skipped' })
            expect(mail.withGmail).not.toHaveBeenCalled()
        })

        it('a deleted message is recorded as missing and nothing else happens', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail({ missing: ['m1'] })
            const result = await createStarredTask({ db, mail })
            expect(result.state).toBe('missing')
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([])
        })
    })

    describe('a failed star never fails the task and is finished on the next request', () => {
        it('retries a transient Gmail error once', async () => {
            const db = createFakeDatabase()
            const rateLimited = Object.assign(new Error('Rate limit exceeded'), { code: 429 })
            const mail = createFakeGmail({ failModify: [rateLimited] })
            const result = await createStarredTask({ db, mail })
            expect(result.state).toBe('starred')
            expect(mail.calls.filter(call => call.type === 'modify')).toHaveLength(2)
        })

        it('keeps the entry pending on a lasting error, then resumes it without a second task', async () => {
            const db = createFakeDatabase()
            const forbidden = Object.assign(new Error('Insufficient Permission'), { code: 403 })
            const mail = createFakeGmail({ failModify: [forbidden] })
            const result = await createStarredTask({ db, mail })

            expect(result.state).toBe('error')
            expect(db.docs.get(`users/${OWNER}/gmailTaskStars/t1`)).toMatchObject({
                state: 'pending',
                wasStarredBefore: false,
                lastError: 'Insufficient Permission',
            })
            expect(mail.isStarred('m1')).toBe(false)

            const resumed = await resumePendingTaskEmailStar(
                { userId: OWNER, taskId: 't1' },
                { database: db, withGmail: mail.withGmail }
            )
            expect(resumed.state).toBe('starred')
            expect(mail.isStarred('m1')).toBe(true)
        })

        it('does not star a task created before AT-3165 (no entry) when it is asked for again', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            const resumed = await resumePendingTaskEmailStar(
                { userId: OWNER, taskId: 'old-task' },
                { database: db, withGmail: mail.withGmail }
            )
            expect(resumed.state).toBe('skipped')
            expect(mail.withGmail).not.toHaveBeenCalled()
        })
    })

    describe('Done removes the star, a workflow step does not', () => {
        it('removes only STARRED when inDone turns true and leaves INBOX and UNREAD alone', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            mail.calls.length = 0

            const result = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: emailTask(), after: emailTask({ inDone: true }) },
                { database: db, withGmail: mail.withGmail }
            )

            expect(result.action).toBe('unstarred')
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([
                { type: 'modify', id: 'm1', requestBody: { removeLabelIds: ['STARRED'] } },
            ])
            expect([...mail.labels.get('m1')].sort()).toEqual(['INBOX', 'UNREAD'])
            expect(db.docs.get(`users/${OWNER}/gmailTaskStars/t1`)).toMatchObject({
                state: 'removed',
                removedReason: 'done',
            })
        })

        it('moving through workflow steps (inDone stays false) does not touch Gmail', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            mail.withGmail.mockClear()

            const before = emailTask({ userIds: [OWNER], stepHistory: ['-1'] })
            const after = emailTask({ userIds: [OWNER, 'reviewer'], userId: 'reviewer', stepHistory: ['-1', 'step-1'] })
            const result = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before, after },
                { database: db, withGmail: mail.withGmail }
            )

            expect(result.action).toBe('none')
            expect(mail.withGmail).not.toHaveBeenCalled()
            expect(mail.isStarred('m1')).toBe(true)
        })

        it('reopening stars the message again, and Done again removes it again', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            const options = { database: db, withGmail: mail.withGmail }
            const open = emailTask()
            const done = emailTask({ inDone: true })

            await syncTaskEmailStarOnTaskUpdate({ projectId: 'p1', taskId: 't1', before: open, after: done }, options)
            expect(mail.isStarred('m1')).toBe(false)

            const reopened = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: done, after: open },
                options
            )
            expect(reopened.action).toBe('starred')
            expect(mail.isStarred('m1')).toBe(true)

            await syncTaskEmailStarOnTaskUpdate({ projectId: 'p1', taskId: 't1', before: open, after: done }, options)
            expect(mail.isStarred('m1')).toBe(false)
        })

        it('keeps the star while another open task of the same email holds it', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail, taskId: 't1' })
            // The second task sees the star Alldone set, and shares it rather than taking it as the user's.
            const second = await createStarredTask({ db, mail, taskId: 't2' })
            expect(second.state).toBe('starred')
            const options = { database: db, withGmail: mail.withGmail }

            await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: emailTask(), after: emailTask({ inDone: true }) },
                options
            )
            db.docs.set('items/p1/tasks/t1', emailTask({ inDone: true }))
            expect(mail.isStarred('m1')).toBe(true)

            await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't2', before: emailTask(), after: emailTask({ inDone: true }) },
                options
            )
            expect(mail.isStarred('m1')).toBe(false)
        })

        it('a Gmail failure on Done never throws out of the trigger', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            mail.withGmail.mockImplementation(async () => {
                throw new Error('invalid_grant')
            })
            const result = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: emailTask(), after: emailTask({ inDone: true }) },
                { database: db, withGmail: mail.withGmail }
            )
            expect(result.action).toBe('error')
            // Still starred in the registry: Done again (after reopening) tries again.
            expect(db.docs.get(`users/${OWNER}/gmailTaskStars/t1`).state).toBe('starred')
        })
    })

    describe('account scoping (gmailData is member-writable)', () => {
        it('ignores a task whose gmailData names another member when that member has no entry for it', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail({ starred: ['victim-message'] })
            const forged = emailTask({
                gmailData: { ...emailTask().gmailData, accountUserId: 'victim', messageId: 'victim-message' },
            })
            const result = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 'attacker-task', before: forged, after: { ...forged, inDone: true } },
                { database: db, withGmail: mail.withGmail }
            )
            expect(result.action).toBe('none')
            expect(mail.withGmail).not.toHaveBeenCalled()
            expect(mail.isStarred('victim-message')).toBe(true)
        })

        it('acts on the message recorded at creation, not on a message id edited into the task later', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail({ starred: ['other-message'] })
            await createStarredTask({ db, mail })
            const edited = emailTask({ gmailData: { ...emailTask().gmailData, messageId: 'other-message' } })
            await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p1', taskId: 't1', before: edited, after: { ...edited, inDone: true } },
                { database: db, withGmail: mail.withGmail }
            )
            expect(mail.isStarred('m1')).toBe(false)
            expect(mail.isStarred('other-message')).toBe(true)
        })

        it('ignores a copy with the same task id in another project while the original still exists', async () => {
            const db = createFakeDatabase()
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            mail.withGmail.mockClear()
            const result = await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p-other', taskId: 't1', before: emailTask(), after: emailTask({ inDone: true }) },
                { database: db, withGmail: mail.withGmail }
            )
            expect(result.action).toBe('none')
            expect(mail.withGmail).not.toHaveBeenCalled()
        })
    })

    describe('deleting the task', () => {
        it('removes the star Alldone set', async () => {
            const db = createFakeDatabase({ [`users/${OWNER}`]: { projectIds: ['p1'] } })
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            db.docs.delete('items/p1/tasks/t1')

            const result = await syncTaskEmailStarOnTaskDelete(
                { projectId: 'p1', taskId: 't1', task: emailTask() },
                { database: db, withGmail: mail.withGmail }
            )
            expect(result.action).toBe('unstarred')
            expect(mail.isStarred('m1')).toBe(false)
            expect(db.docs.get(`users/${OWNER}/gmailTaskStars/t1`).state).toBe('deleted')
        })

        it('keeps the star when the delete is the second half of a project move', async () => {
            const db = createFakeDatabase({
                [`users/${OWNER}`]: { projectIds: ['p1', 'p2'] },
                'projects/p2': { userIds: [OWNER] },
            })
            const mail = createFakeGmail()
            await createStarredTask({ db, mail })
            db.docs.set('items/p2/tasks/t1', emailTask())
            db.docs.delete('items/p1/tasks/t1')
            mail.withGmail.mockClear()

            const result = await syncTaskEmailStarOnTaskDelete(
                { projectId: 'p1', taskId: 't1', task: emailTask() },
                { database: db, withGmail: mail.withGmail }
            )
            expect(result).toEqual({ action: 'moved', projectId: 'p2' })
            expect(mail.withGmail).not.toHaveBeenCalled()
            expect(mail.isStarred('m1')).toBe(true)

            // Done in the new project removes it.
            await syncTaskEmailStarOnTaskUpdate(
                { projectId: 'p2', taskId: 't1', before: emailTask(), after: emailTask({ inDone: true }) },
                { database: db, withGmail: mail.withGmail }
            )
            expect(mail.isStarred('m1')).toBe(false)
        })

        it('never touches a star the user had before', async () => {
            const db = createFakeDatabase({ [`users/${OWNER}`]: { projectIds: ['p1'] } })
            const mail = createFakeGmail({ starred: ['m1'] })
            await createStarredTask({ db, mail })
            db.docs.delete('items/p1/tasks/t1')
            await syncTaskEmailStarOnTaskDelete(
                { projectId: 'p1', taskId: 't1', task: emailTask() },
                { database: db, withGmail: mail.withGmail }
            )
            expect(mail.isStarred('m1')).toBe(true)
            expect(mail.calls.filter(call => call.type === 'modify')).toEqual([])
        })
    })
})

describe('gmailTaskStar wiring (AT-3165)', () => {
    const fs = require('fs')
    const path = require('path')
    const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')

    test('the task triggers sync the star on Done/reopen and on delete', () => {
        const index = read('functions/index.js')
        const onUpdateTask = index.slice(
            index.indexOf('exports.onUpdateTaskSecondGen'),
            index.indexOf('exports.onCreateObjectCommentSecondGen')
        )
        expect(onUpdateTask).toContain('syncGmailTaskStarIfDoneChanged(event)')
        const guard = index.slice(
            index.indexOf('async function syncGmailTaskStarIfDoneChanged'),
            index.indexOf('exports.onUpdateTaskSecondGen')
        )
        // Only an inDone flip of an email task reads anything; workflow steps return at once.
        expect(guard).toContain('if ((before.inDone === true) === (after.inDone === true)) return')
        expect(guard).toContain('syncTaskEmailStarOnTaskUpdate')

        const onDeleteTask = index.slice(index.indexOf('exports.onDeleteTaskSecondGen'))
        expect(onDeleteTask.slice(0, 1200)).toContain('syncTaskEmailStarOnTaskDelete')
    })

    test('the star registry is server-written in firestore.rules', () => {
        const rules = read('firestore.rules')
        const serverOwned = rules.slice(
            rules.indexOf('function isServerOwnedUserCollection'),
            rules.indexOf('function ownerUpdatePreservesProjectMembership')
        )
        expect(serverOwned).toContain("'gmailTaskStars'")
    })
})
