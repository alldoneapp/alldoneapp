const { browserWorkspace } = require('./browserWorkspace')
const { beginBrowserStep } = require('./browserAudit')
const { resolveBrowserConfig } = require('./browserConfig')
const { FirestoreDouble } = require('./__browserFirestoreDouble')
const { claimBrowserGesture, releaseBrowserGesture } = require('../annaWorkspaceControl')

const now = Date.now()
const env = {
    BROWSER_WORKER_URL: 'https://browser-worker.example',
    BROWSER_WORKER_SIGNING_SECRET: 'test-key',
    BROWSER_ALLOWED_DOMAINS: 'shop.example',
}
async function setup() {
    const db = new FirestoreDouble({ 'users/u1': { gold: 50 }, 'projects/p1': { userIds: ['u1'] } })
    const started = await beginBrowserStep(db, {
        projectId: 'p1',
        objectId: 'c1',
        objectType: 'topics',
        assistantId: 'a1',
        requestUserId: 'u1',
        toolName: 'browser_navigate',
        action: 'navigate',
        startsRun: true,
        config: resolveBrowserConfig({ env }),
        now,
    })
    const worker = jest.fn().mockResolvedValue({
        ok: true,
        screenshotBase64: 'viewport-pixels',
        url: 'https://shop.example/',
        title: 'Shop',
        viewport: { width: 1280, height: 900 },
    })
    const deductGold = jest.fn().mockResolvedValue({ success: true })
    const args = { db, env, userId: 'u1', runId: started.runId, now, deps: { callBrowserWorker: worker, deductGold } }
    return {
        db,
        worker,
        deductGold,
        args,
        runId: started.runId,
        call: (action, input) => browserWorkspace({ ...args, action, input }),
    }
}

it('shows a real worker frame to its owner without billing or storing pixels', async () => {
    const { call, db, deductGold } = await setup()
    const result = await call('frame')
    expect(result.screenshotDataUrl).toBe('data:image/jpeg;base64,viewport-pixels')
    expect(result.control).toBe('assistant')
    expect(deductGold).not.toHaveBeenCalled()
    expect(JSON.stringify([...db.documents.values()])).not.toContain('viewport-pixels')
})

it('refuses another user and a revoked project member before contacting the worker', async () => {
    const { args, db, worker } = await setup()
    await expect(browserWorkspace({ ...args, userId: 'u2' })).rejects.toMatchObject({ code: 'permission-denied' })
    await db.doc('projects/p1').set({ userIds: [] })
    await expect(browserWorkspace(args)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(worker).not.toHaveBeenCalled()
})

it('lets an in-flight assistant gesture finish before human gestures and blocks the next assistant action', async () => {
    const { db, runId, call, worker } = await setup()
    const gesture = await claimBrowserGesture(db, runId, 'u1', false, now)
    expect(await call('take')).toMatchObject({ control: 'user', ready: false })
    await expect(call('click', { x: 10, y: 20 })).rejects.toMatchObject({ code: 'failed-precondition' })
    await releaseBrowserGesture(db, runId, gesture.token)
    expect(await claimBrowserGesture(db, runId, 'u1', false, now)).toMatchObject({
        ok: false,
        reason: 'user_controls_browser',
    })
    await call('click', { x: 10, y: 20 })
    expect(worker).toHaveBeenCalledTimes(1)
    expect(await call('release')).toMatchObject({ control: 'assistant', resume: { projectId: 'p1', objectId: 'c1' } })
    expect(await claimBrowserGesture(db, runId, 'u1', false, now)).toMatchObject({ ok: true })
})

it('requires explicit control, charges only performed gestures and keeps typed text out of storage', async () => {
    const { call, worker, db, deductGold } = await setup()
    await expect(call('type', { text: 'not-sent' })).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(worker).not.toHaveBeenCalled()
    await call('take')
    await call('type', { text: 'human-only-password' })
    expect(worker.mock.calls[0][0].payload.text).toBe('human-only-password')
    expect(deductGold).toHaveBeenCalledTimes(1)
    expect(JSON.stringify([...db.documents.values()])).not.toContain('human-only-password')
})

it('stops showing or operating an expired session', async () => {
    const { args, worker } = await setup()
    await expect(browserWorkspace({ ...args, now: now + 11 * 60000 })).rejects.toMatchObject({
        code: 'failed-precondition',
    })
    expect(worker).not.toHaveBeenCalled()
})
