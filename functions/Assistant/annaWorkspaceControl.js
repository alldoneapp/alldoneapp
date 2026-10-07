const { randomUUID } = require('crypto')
const { sanitizeCallPageContext } = require('../WhatsApp/assistantCallPageContext')

const controlRef = (db, userId) => db.doc(`users/${userId}/private/annaWorkspace`)
const WORKSPACE_WRITES = new Set([
    'create_task',
    'update_task',
    'create_note',
    'update_note',
    'update_contact',
    'add_chat_comment',
])

async function getAnnaControlBlock({ db, userId, toolName, toolArgs = {}, runtime }) {
    if (!userId || !WORKSPACE_WRITES.has(toolName)) return null
    return db.runTransaction(async tx => {
        const state = (await tx.get(controlRef(db, userId))).data()
        if (state?.control !== 'user') return null
        const page = sanitizeCallPageContext(state.page)
        const match = page?.path.match(/^\/projects\/([^/]+)\/(tasks|notes|goals)\/([^/]+)\//)
        const ids = [toolArgs.taskId, toolArgs.noteId, toolArgs.goalId, toolArgs.objectId, toolArgs.task_id]
        const affectsObject =
            match && ids.includes(match[3]) && (!toolArgs.projectId || toolArgs.projectId === match[1])
        if (!runtime?.annaConversation && !affectsObject) return null
        if (runtime?.objectId && runtime?.projectId && runtime?.assistantId) {
            tx.set(
                controlRef(db, userId),
                {
                    blocked: {
                        projectId: runtime.projectId,
                        objectId: runtime.objectId,
                        objectType: runtime.objectType || 'topics',
                        assistantId: runtime.assistantId,
                        at: Date.now(),
                    },
                },
                { merge: true }
            )
        }
        return {
            success: false,
            paused: true,
            reason: 'user_controls_workspace',
            message:
                'The user is interacting with Alldone. Do not change it or retry during this request. You can continue talking and inspecting. A new user chat request or voice call automatically releases the workspace; do not ask the user to operate a control switch.',
        }
    })
}

// A browser gesture already in flight is allowed to finish. A takeover prevents the next gesture,
// and the human controls remain disabled until this bounded lease has settled.
async function claimBrowserGesture(db, runId, userId, human = false, now = Date.now()) {
    const ref = db.doc(`browserRuns/${runId}`)
    return db.runTransaction(async tx => {
        const run = (await tx.get(ref)).data()
        if (!run || run.requestUserId !== userId) return { ok: false, reason: 'not_owner' }
        if ((run.workspaceControl === 'user') !== human) {
            if (!human) tx.set(ref, { workspacePaused: true }, { merge: true })
            return { ok: false, reason: 'user_controls_browser' }
        }
        if (run.workspaceGesture?.until > now) return { ok: false, reason: 'browser_busy' }
        const token = randomUUID()
        tx.set(ref, { workspaceGesture: { token, until: now + 90000 } }, { merge: true })
        return { ok: true, token }
    })
}

async function releaseBrowserGesture(db, runId, token) {
    const ref = db.doc(`browserRuns/${runId}`)
    await db.runTransaction(async tx => {
        const run = (await tx.get(ref)).data()
        if (run?.workspaceGesture?.token === token) tx.set(ref, { workspaceGesture: null }, { merge: true })
    })
}

module.exports = { controlRef, getAnnaControlBlock, claimBrowserGesture, releaseBrowserGesture }
