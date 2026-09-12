const { requestAnnaHighlight } = require('./annaHighlight')
const runtime = { requestUserId: 'u1', projectId: 'p1', objectType: 'topics', objectId: 'anna_u1' }
const screen = {
    id: 'screen-1',
    path: '/projects/tasks/open',
    targets: [{ id: 'target-1', text: 'Prepare the project review' }],
}
const setup = (overrides = {}) => {
    const chat = { annaOwnerId: 'u1', creatorId: 'u1', annaScreenContext: screen, ...overrides }
    const update = jest.fn(async patch => Object.assign(chat, patch))
    const db = {
        doc: path => ({
            get: async () => ({ exists: true, data: () => (path === 'projects/p1' ? { userIds: ['u1'] } : chat) }),
            update,
        }),
    }
    return { db, update, chat }
}
const mark = { action: 'mark', screenId: 'screen-1', targetId: 'target-1', quote: 'project review' }
it('inspects only the authenticated owner workspace and returns bounded reference text', async () => {
    const { db, update } = setup()
    expect(await requestAnnaHighlight({ db, runtime, args: { action: 'inspect' } })).toMatchObject({
        status: 'ready',
        screen,
    })
    expect(update).not.toHaveBeenCalled()
    await expect(
        requestAnnaHighlight({ db, runtime: { ...runtime, requestUserId: 'u2' }, args: { action: 'inspect' } })
    ).rejects.toMatchObject({ code: 'permission-denied' })
})
it('queues an exact highlight with an expiry without claiming it was seen', async () => {
    const { db, chat } = setup()
    expect(await requestAnnaHighlight({ db, runtime, args: mark, now: 100 })).toMatchObject({
        status: 'queued',
        text: 'project review',
    })
    expect(chat.annaHighlight).toMatchObject({
        screenId: 'screen-1',
        targetId: 'target-1',
        path: screen.path,
        expiresAt: 12100,
        style: 'marker',
    })
})
it.each([
    [{ screenId: 'stale' }, 'failed-precondition'],
    [{ targetId: 'invented' }, 'not-found'],
    [{ quote: 'different text' }, 'invalid-argument'],
    [{ durationSeconds: 1000 }, 'invalid-argument'],
    [{ style: 'javascript' }, 'invalid-argument'],
])('rejects a stale or unsupported mark %j', async (change, code) => {
    const { db, update } = setup()
    await expect(requestAnnaHighlight({ db, runtime, args: { ...mark, ...change } })).rejects.toMatchObject({ code })
    expect(update).not.toHaveBeenCalled()
})
it('refuses an ambiguous partial quote', async () => {
    const { db } = setup({
        annaScreenContext: { ...screen, targets: [{ id: 'target-1', text: 'Review then Review' }] },
    })
    await expect(requestAnnaHighlight({ db, runtime, args: { ...mark, quote: 'Review' } })).rejects.toMatchObject({
        code: 'invalid-argument',
    })
})
it('reports an unavailable workspace and supports explicit clearing', async () => {
    const { db, chat } = setup({ annaScreenContext: null })
    expect(await requestAnnaHighlight({ db, runtime, args: { action: 'inspect' } })).toMatchObject({
        status: 'not_ready',
    })
    await requestAnnaHighlight({ db, runtime, args: { action: 'clear' } })
    expect(chat.annaHighlight.action).toBe('clear')
})
