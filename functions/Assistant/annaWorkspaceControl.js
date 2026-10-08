const { randomUUID } = require('crypto')

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

module.exports = { claimBrowserGesture, releaseBrowserGesture }
