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
    progress.update('Searching tasks')
    expect(tick()).toBe(false)
    progress.update('Checking notes')
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
    expect(publish.mock.calls).toEqual([['Checking notes']])
    jest.advanceTimersByTime(44000)
    expect(tick()).toBe(false)
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
    progress.update('Reviewing results')
    jest.advanceTimersByTime(19000)
    expect(tick()).toBe(false)
    jest.advanceTimersByTime(1000)
    expect(tick()).toBe(true)
})

test('waits for a conversational pause and stops immediately on completion', () => {
    const publish = jest.fn()
    const progress = createLiveProgress({ publish })
    progress.update('Searching the calendar for the requested date.')
    jest.advanceTimersByTime(9000)
    expect(progress.tick({ active: false, lastSpeechAt: 0 })).toBe(false)
    const speech = Date.now()
    expect(progress.tick({ active: true, lastSpeechAt: speech })).toBe(false)
    jest.advanceTimersByTime(4000)
    expect(progress.tick({ active: true, lastSpeechAt: speech })).toBe(true)
    progress.stop()
    progress.update('Stale tool result')
    jest.advanceTimersByTime(60000)
    expect(progress.tick({ active: true, lastSpeechAt: 0 })).toBe(false)
    expect(publish).toHaveBeenCalledTimes(1)
})

test('uses existing activity labels without arguments, tool identifiers or invented completion', () => {
    expect(toolProgress('web_search')).toContain('Searching the web')
    expect(toolProgress('create_task')).toContain('Creating a task')
    expect(toolProgress('unknown_private_tool')).toBe('Waiting for the connected service to respond')
    expect(backgroundProgress({ status: 'cancel_requested' })).toEqual({
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
    progress.update({ content: 'Calendar write permission missing', urgent: true })
    jest.advanceTimersByTime(2500)
    const spokenAt = Date.now()
    expect(progress.tick({ active: true, lastSpeechAt: spokenAt })).toBe(false)
    jest.advanceTimersByTime(4000)
    expect(progress.tick({ active: true, lastSpeechAt: spokenAt })).toBe(true)
    expect(publish).toHaveBeenCalledWith('Calendar write permission missing')
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
    expect(backgroundProgress({ status: 'failed', error: 'Authentication expired', output: 'Private output' })).toEqual(
        {
            content: expect.stringContaining('Authentication expired'),
            terminal: true,
        }
    )
})
