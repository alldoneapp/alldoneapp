const {
    createLiveProgress,
    createLiveToolProgress,
    toolProgress,
    voiceToolFailure,
    backgroundProgress,
} = require('./assistantLiveProgress')

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('coalesces stages, leaves quick requests quiet and spaces unchanged waits further apart', () => {
    const publish = jest.fn()
    const progress = createLiveProgress({ publish })
    const tick = () => progress.tick({ active: true, lastSpeechAt: 0 })
    jest.advanceTimersByTime(7000)
    progress.update({ status: 'running', step: 'Searching tasks' })
    expect(tick()).toBe(false)
    progress.update({ status: 'running', step: 'Checking notes' })
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
    expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', step: 'Checking notes', cause: null })
    )
    jest.advanceTimersByTime(44000)
    expect(tick()).toBe(false)
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
    progress.update({ status: 'running', step: 'Reviewing results' })
    jest.advanceTimersByTime(19000)
    expect(tick()).toBe(false)
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
})

test('waits for a conversational pause and stops immediately on completion', () => {
    const publish = jest.fn()
    const progress = createLiveProgress({ publish })
    progress.update({ status: 'running', step: 'Searching the calendar for the requested date.' })
    jest.advanceTimersByTime(9000)
    expect(progress.tick({ active: false, lastSpeechAt: 0 })).toBe(false)
    const speech = Date.now()
    expect(progress.tick({ active: true, lastSpeechAt: speech })).toBe(false)
    jest.advanceTimersByTime(4000)
    expect(progress.tick({ active: true, lastSpeechAt: speech })).toBe(true)
    progress.stop()
    progress.update({ status: 'running', step: 'Stale tool result' })
    jest.advanceTimersByTime(60000)
    expect(progress.tick({ active: true, lastSpeechAt: 0 })).toBe(false)
    expect(publish).toHaveBeenCalledTimes(1)
})

test('uses existing activity labels without arguments, tool identifiers or invented completion', () => {
    expect(toolProgress('web_search')).toContain('Searching the web')
    expect(toolProgress('create_task')).toContain('Creating a task')
    expect(toolProgress('unknown_private_tool')).toBe('Waiting for the connected service to respond')
    expect(backgroundProgress({ status: 'cancel_requested' })).toMatchObject({
        content: expect.stringContaining('not confirmed'),
        terminal: false,
    })
    expect(backgroundProgress({ status: 'completed' }).terminal).toBe(true)
    expect(backgroundProgress({ status: 'awaiting_user' }).content).toContain('needs your input')
    expect(backgroundProgress({ status: 'unknown', output: 'private' })).toBeNull()
})

test('stays quiet when no actual status has been supplied', () => {
    const publish = jest.fn()
    const progress = createLiveProgress({ publish })
    jest.advanceTimersByTime(60000)
    expect(progress.tick({ active: true, lastSpeechAt: 0 })).toBe(false)
    expect(publish).not.toHaveBeenCalled()
})

test('names active parallel work and retains a tool error until that tool recovers', () => {
    const publish = jest.fn()
    const progress = createLiveToolProgress({ publish })
    const search = progress.start('web_search', { query: 'Riesendrachen start time' })
    const weather = progress.start('get_weather', { location: 'Berlin' })
    expect(publish.mock.calls.at(-1)[0].content).toContain('Riesendrachen start time')
    expect(publish.mock.calls.at(-1)[0].content).toContain('Berlin')
    const extra = ['Sunday events', 'Museum hours', 'Train timetable'].map(query =>
        progress.start('web_search', { query })
    )
    expect(publish.mock.calls.at(-1)[0].content).toContain('plus 3 other lookups')
    extra.forEach(id => progress.finish(id, { success: true }))
    progress.finish(search, { success: false, error: 'Search request timed out' })
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({
        urgent: true,
        content: expect.stringContaining('Search request timed out'),
    })
    expect(publish.mock.calls.at(-1)[0].content).toContain('Berlin')
    progress.finish(weather, { success: true })
    expect(publish.mock.calls.at(-1)[0].content).toContain('Search request timed out')
    const retry = progress.start('web_search', { query: 'Riesendrachen start time' })
    progress.finish(retry, { success: true })
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({
        urgent: false,
        content: expect.stringContaining('returned a result'),
    })
    expect(publish.mock.calls.at(-1)[0].content).not.toContain('timed out')
})

test('surfaces a concrete error at the next conversational pause without waiting for the normal update interval', () => {
    const publish = jest.fn()
    const progress = createLiveProgress({ publish })
    progress.update({ status: 'failed', cause: 'Calendar write permission missing', step: 'Creating the event' })
    jest.advanceTimersByTime(2500)
    const spokenAt = Date.now()
    expect(progress.tick({ active: true, lastSpeechAt: spokenAt })).toBe(false)
    jest.advanceTimersByTime(4000)
    expect(progress.tick({ active: true, lastSpeechAt: spokenAt })).toBe(true)
    expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', cause: 'Calendar write permission missing' })
    )
})

test('keeps actionable error text while removing credentials and addresses', () => {
    const message = voiceToolFailure(
        null,
        new Error('403 Forbidden Bearer secret-token at https://private.example/path for user@example.com')
    )
    expect(message).toContain('403 Forbidden')
    expect(message).not.toContain('secret-token')
    expect(message).not.toContain('private.example')
    expect(message).not.toContain('user@example.com')
    expect(
        backgroundProgress({ status: 'failed', error: 'Authentication expired', output: 'Private output' })
    ).toMatchObject({
        content: expect.stringContaining('Authentication expired'),
        terminal: true,
    })
})

test('replays ten successful lookups without inventing any error, including empty and error-related search results', () => {
    const publish = jest.fn()
    const publishContext = jest.fn()
    const scheduled = createLiveProgress({ publish, publishContext })
    const tools = createLiveToolProgress({ publish: scheduled.update })
    for (let round = 0; round < 2; round++) {
        const ids = Array.from({ length: 5 }, (_, i) =>
            tools.start('web_search', { query: `error reports ${round}-${i}` })
        )
        jest.advanceTimersByTime(21000)
        scheduled.tick({ active: true, lastSpeechAt: 0 })
        ids.forEach(id =>
            tools.finish(id, {
                success: true,
                status: 200,
                results: [],
                text: 'Error messages are mentioned in the retrieved page',
            })
        )
        jest.advanceTimersByTime(21000)
        scheduled.tick({ active: true, lastSpeechAt: 0 })
    }
    expect(publish).toHaveBeenCalled()
    for (const [update] of publish.mock.calls) expect(update).toMatchObject({ cause: null, urgent: false })
    expect(publishContext).toHaveBeenCalledTimes(1)
    expect(JSON.parse(publishContext.mock.calls[0][0])).toMatchObject({ type: 'application_error_state', error: null })
})

test('clears errors quietly after a successful retry while speech and other tool calls continue', () => {
    const publish = jest.fn(),
        publishContext = jest.fn()
    const scheduled = createLiveProgress({ publish, publishContext })
    const tools = createLiveToolProgress({ publish: scheduled.update })
    const old = tools.start('web_search', { query: 'Sunday', depth: 'basic' })
    tools.finish(old, { success: false, error: 'HTTP 429 rate limit' })
    jest.advanceTimersByTime(2500)
    scheduled.tick({ active: true, lastSpeechAt: Date.now() })
    expect(publish).not.toHaveBeenCalled()
    expect(JSON.parse(publishContext.mock.calls.at(-1)[0]).error.cause).toBe('HTTP 429 rate limit')
    const retry = tools.start('web_search', { depth: 'basic', query: 'Sunday' })
    tools.start('get_weather', { location: 'Berlin' })
    tools.finish(retry, { success: true })
    scheduled.tick({ active: true, lastSpeechAt: Date.now() })
    expect(JSON.parse(publishContext.mock.calls.at(-1)[0]).error).toBeNull()
    expect(publish).not.toHaveBeenCalled()
    jest.advanceTimersByTime(9000)
    scheduled.tick({ active: true, lastSpeechAt: 0 })
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({ status: 'running', cause: null })
})

test('a late older result cannot clear or resurrect a newer attempt error', () => {
    const publish = jest.fn()
    const tools = createLiveToolProgress({ publish })
    const older = tools.start('web_search', { query: 'Sunday' })
    const newer = tools.start('web_search', { query: 'Sunday' })
    tools.finish(newer, { success: false, error: 'Latest request timed out' })
    tools.finish(older, { success: true })
    expect(publish.mock.calls.at(-1)[0].cause).toBe('Latest request timed out')
    const retry = tools.start('web_search', { query: 'Sunday' })
    tools.finish(retry, { success: true })
    expect(publish.mock.calls.at(-1)[0].cause).toBeNull()
})

test('a retry using the canonical note ID clears the failure from its contact alias', () => {
    const publish = jest.fn()
    const progress = createLiveToolProgress({ publish })
    const first = progress.start('get_notes', { projectId: 'p', noteId: 'contact-1' })
    progress.retarget(first, 'get_notes', { projectId: 'p', noteId: 'note-1' })
    progress.finish(first, { success: false, error: 'Storage temporarily unavailable' })
    const retry = progress.start('get_notes', { projectId: 'p', noteId: 'note-1' })
    progress.finish(retry, { success: true, note: { id: 'note-1' } })
    expect(publish.mock.calls.at(-1)[0]).toMatchObject({ status: 'result_received', cause: null })
})
