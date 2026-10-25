import { drainMeetingQueue } from './meetingQueue'

const setup = (count = 3) => {
    const rows = new Map(
        Array.from({ length: count }, (_, sequence) => [
            `s:${sequence}`,
            { id: `s:${sequence}`, owner: 'u:n', sequence, createdAt: 1, blob: `audio-${sequence}` },
        ])
    )
    const copy = value => JSON.parse(JSON.stringify(value))
    const queue = {
        list: jest.fn(async owner =>
            [...rows.values()]
                .filter(value => value.owner === owner)
                .map(copy)
                .reverse()
        ),
        put: jest.fn(async value => rows.set(value.id, copy(value))),
        remove: jest.fn(async id => rows.delete(id)),
    }
    const transcribe = jest.fn(async value => `text-${value.sequence}`)
    const persist = jest.fn(async () => true)
    return { rows, queue, transcribe, persist, owner: 'u:n' }
}

test('360 synthetic chunks drain sequentially in capture order, despite reverse storage order', async () => {
    const run = setup(360)
    let inFlight = 0
    run.transcribe = jest.fn(async chunk => {
        expect(++inFlight).toBe(1)
        await Promise.resolve()
        inFlight--
        return `text-${chunk.sequence}`
    })
    await drainMeetingQueue(run)
    expect(run.rows.size).toBe(0)
    expect(run.persist.mock.calls.map(([chunk]) => chunk.sequence)).toEqual(Array.from({ length: 360 }, (_, i) => i))
})

test('failed note save retains audio and transcript; reopening retries persistence without transcription', async () => {
    const run = setup()
    run.persist.mockResolvedValueOnce(false)
    await expect(drainMeetingQueue(run)).rejects.toThrow('note-pending')
    expect(run.rows.size).toBe(3)
    expect(run.rows.get('s:0').text).toBe('text-0')
    await drainMeetingQueue({ ...run, owner: 'other-user:n' })
    expect(run.persist).toHaveBeenCalledTimes(1)
    await drainMeetingQueue(run)
    expect(run.transcribe).toHaveBeenCalledTimes(3)
    expect(run.rows.size).toBe(0)
})

test('lost response keeps first audio and blocks later chunks; retry uses the same ID', async () => {
    const run = setup()
    run.transcribe.mockRejectedValueOnce(new Error('offline'))
    await expect(drainMeetingQueue(run)).rejects.toThrow('offline')
    expect(run.persist).not.toHaveBeenCalled()
    expect(run.rows.size).toBe(3)
    await drainMeetingQueue(run)
    expect(run.transcribe.mock.calls.slice(0, 2).map(([chunk]) => chunk.id)).toEqual(['s:0', 's:0'])
})

test('local result commit failure never inserts into note or deletes audio', async () => {
    const run = setup()
    run.queue.put.mockRejectedValueOnce(new Error('quota'))
    await expect(drainMeetingQueue(run)).rejects.toThrow('quota')
    expect(run.persist).not.toHaveBeenCalled()
    expect(run.rows.size).toBe(3)
})

test('closing during transcription commits result but leaves insertion for recovery', async () => {
    const run = setup()
    let active = true
    run.transcribe.mockImplementationOnce(async () => {
        active = false
        return 'saved result'
    })
    await drainMeetingQueue({ ...run, isActive: () => active })
    expect(run.rows.get('s:0').text).toBe('saved result')
    expect(run.persist).not.toHaveBeenCalled()
})
