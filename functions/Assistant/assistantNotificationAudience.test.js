'use strict'

// security audit 2026-11: askToBotSecondGen / generatePreConfigTaskResultSecondGen received
// followerIds and userIdsToNotify from request.data, and the Admin SDK fan-out pushed, emailed and
// WhatsApp-ed every listed uid. The server now narrows both lists to the thread's audience.

const fs = require('fs')
const path = require('path')

const { narrowAssistantNotificationRecipients } = require('./assistantNotificationAudience')

function makeDb(docs) {
    return {
        doc: docPath => ({
            get: async () => ({ exists: docPath in docs, data: () => docs[docPath] }),
        }),
    }
}

const project = { 'projects/p1': { userIds: ['caller', 'member', 'private-owner'] } }

describe('narrowAssistantNotificationRecipients', () => {
    test('drops ids outside the project and keeps members who can read a public task', async () => {
        const db = makeDb({ ...project, 'items/p1/tasks/t1': { isPublicFor: [0] } })

        await expect(
            narrowAssistantNotificationRecipients(
                db,
                { projectId: 'p1', objectType: 'tasks', objectId: 't1' },
                { followerIds: ['caller', 'stranger', 'member'], userIdsToNotify: ['stranger', 'member', 'member'] }
            )
        ).resolves.toEqual({ followerIds: ['caller', 'member'], userIdsToNotify: ['member'] })
    })

    test('keeps only the readers of a private object', async () => {
        const db = makeDb({ ...project, 'noteItems/p1/notes/n1': { isPublicFor: ['caller'] } })

        await expect(
            narrowAssistantNotificationRecipients(
                db,
                { projectId: 'p1', objectType: 'notes', objectId: 'n1' },
                { followerIds: ['caller', 'member'], userIdsToNotify: ['member'] }
            )
        ).resolves.toEqual({ followerIds: ['caller'], userIdsToNotify: [] })
    })

    test('treats a member board and an assistant board as readable by members only', async () => {
        const db = makeDb(project)

        await expect(
            narrowAssistantNotificationRecipients(
                db,
                { projectId: 'p1', objectType: 'users', objectId: 'member' },
                { followerIds: ['member', 'stranger'] }
            )
        ).resolves.toMatchObject({ followerIds: ['member'] })
        await expect(
            narrowAssistantNotificationRecipients(
                db,
                { projectId: 'p1', objectType: 'assistants', objectId: 'assistant-1' },
                { userIdsToNotify: ['caller', 'stranger'] }
            )
        ).resolves.toMatchObject({ userIdsToNotify: ['caller'] })
    })

    test('notifies nobody when the thread or project cannot be found', async () => {
        await expect(
            narrowAssistantNotificationRecipients(
                makeDb(project),
                { projectId: 'p1', objectType: 'tasks', objectId: 'missing' },
                { followerIds: ['caller'], userIdsToNotify: ['member'] }
            )
        ).resolves.toEqual({ followerIds: [], userIdsToNotify: [] })
    })

    test('both callables pass only the narrowed lists to the run', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
        const callable = name => {
            const start = source.indexOf(`exports.${name} = onCall(`)
            return source.slice(start, source.indexOf('\nexports.', start + 10))
        }
        const askToBot = callable('askToBotSecondGen')
        expect(askToBot).toMatch(/narrowAssistantNotificationRecipients\(/)
        expect(askToBot).toMatch(/recipients\.userIdsToNotify,\s*isPublicFor,/)
        expect(askToBot).toMatch(/assistantId,\s*recipients\.followerIds,/)

        const preConfig = callable('generatePreConfigTaskResultSecondGen')
        expect(preConfig).toMatch(/narrowAssistantNotificationRecipients\(/)
        expect(preConfig).toMatch(/taskId,\s*recipients\.userIdsToNotify,/)
    })
})
