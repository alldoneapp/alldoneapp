import { createAnnaActivityHistory } from './annaActivityHistory'
const notice = {
    id: 'feed/source/tasks/task/feed',
    kind: 'feed',
    sourceProjectId: 'source',
    projectId: 'home',
    chatId: 'anna',
    created: 1000,
    occurredAt: 900,
    path: '/projects/source/user/user/updates/followed',
    projectName: 'Launch',
    entryText: 'created task',
}
beforeEach(() => localStorage.clear())

it('restores append-only history across fresh instances without a count or age cutoff', () => {
    const history = createAnnaActivityHistory()
    for (let i = 0; i < 150; i++) history.append('user', { ...notice, id: notice.id + i, created: i })
    const saved = createAnnaActivityHistory().read('user')
    expect(saved).toHaveLength(150)
    expect(saved[0].created).toBe(0)
    expect(createAnnaActivityHistory().read('other')).toEqual([])
})

it('preserves the first appearance and original conversation when the same unread item returns', () => {
    const first = createAnnaActivityHistory().append('user', notice)
    expect(createAnnaActivityHistory().append('user', { ...notice, created: 2000, chatId: 'tomorrow' })).toEqual(first)
    expect(createAnnaActivityHistory().read('user')).toEqual([first])
})

it('independent tabs append without replacing each other', () => {
    const first = createAnnaActivityHistory(),
        second = createAnnaActivityHistory()
    first.append('user', notice)
    second.append('user', { ...notice, id: notice.id + '2' })
    expect(first.read('user')).toHaveLength(2)
})

it('rejects foreign-account and unsafe saved navigation data and tolerates corrupt records', () => {
    createAnnaActivityHistory().append('user', notice)
    localStorage.setItem('alldone.annaActivity.v1:user:broken', '{')
    localStorage.setItem('alldone.annaActivity.v1:user:foreign', JSON.stringify({ ...notice, userId: 'other' }))
    localStorage.setItem(
        'alldone.annaActivity.v1:user:unsafe',
        JSON.stringify({ ...notice, userId: 'user', path: 'https://evil.example' })
    )
    expect(createAnnaActivityHistory().read('user')).toHaveLength(1)
})

it('keeps a live arrival usable when browser storage is unavailable', () => {
    const history = createAnnaActivityHistory(() => {
        throw new Error('Storage blocked')
    })
    expect(history.read('user')).toEqual([])
    expect(history.append('user', notice)).toMatchObject(notice)
})

it("adds a preview without replacing the arrival, thread, link, or another tab's snapshot", () => {
    const history = createAnnaActivityHistory()
    history.append('user', notice)
    const content = { version: 1, objectName: 'Task title', actorName: 'Anna', preview: '' }
    const enriched = history.enrich(
        'user',
        { ...notice, created: 5000, chatId: 'tomorrow', source: { privatePayload: true } },
        content
    )
    expect(enriched).toMatchObject({ created: 1000, chatId: 'anna', path: notice.path, content })
    expect(enriched.source).toBeUndefined()
    expect(history.enrich('user', notice, { ...content, objectName: 'Later title' })).toEqual(enriched)
    expect(createAnnaActivityHistory().read('user')).toEqual([enriched])
})

it('rejects malformed preview content without removing the original notice', () => {
    const history = createAnnaActivityHistory()
    history.append('user', notice)
    history.enrich('user', notice, { version: 1, objectName: { unsafe: true } })
    expect(history.read('user')).toHaveLength(1)
    expect(history.read('user')[0].content).toBeUndefined()
})
