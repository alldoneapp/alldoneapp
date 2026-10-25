const { createLiveAnswerDelivery, splitLiveAnswer } = require('./assistantLiveAnswerDelivery')
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const setup = result => {
    const append = jest.fn(),
        record = jest.fn(),
        finish = jest.fn(),
        supersede = jest.fn()
    const delivery = createLiveAnswerDelivery({ result, delegationId: 'd1', append, record, finish, supersede })
    const tick = (lastSpeechAt = 0) => delivery.tick({ active: true, lastSpeechAt })
    const acknowledge = () =>
        append.mock.calls.forEach(call =>
            delivery.acknowledge({ type: 'session.commentary.appended', client_event_id: call[3] })
        )
    return { delivery, tick, append, record, finish, supersede, acknowledge }
}
test('sends a short answer through commentary exactly once, without quiet context or a second speaking instruction', () => {
    const s = setup('The calendar event was created.')
    s.tick(Date.now())
    expect(s.append).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1600)
    s.tick()
    expect(s.append.mock.calls.map(call => call.slice(0, 3))).toEqual([
        ['session.commentary.append', 'The calendar event was created.', 'd1'],
    ])
    s.acknowledge()
    expect(s.finish).not.toHaveBeenCalled()
    expect(s.record.mock.calls.some(([data]) => data.outputObservedAfterAnswerAt)).toBe(false)
    s.delivery.observeOutput()
    jest.advanceTimersByTime(4000)
    s.tick()
    expect(s.finish).toHaveBeenCalledTimes(1)
    expect(s.append).toHaveBeenCalledTimes(1)
})
test('preserves every multibyte result part, sends them together, and waits for all matching acknowledgments', () => {
    const text = 'Eine Antwort. 界'.repeat(120)
    const chunks = splitLiveAnswer(text)
    expect(chunks.join('')).toBe(text)
    const s = setup(text)
    s.tick()
    expect(s.append.mock.calls.map(call => call[1].split('\n').slice(1).join('\n')).join('')).toBe(text)
    expect(
        s.append.mock.calls.every(
            call => call[0] === 'session.commentary.append' && Buffer.byteLength(call[1], 'utf8') < 480
        )
    ).toBe(true)
    const [first, ...rest] = s.append.mock.calls
    rest.forEach(call => s.delivery.acknowledge({ type: 'session.commentary.appended', client_event_id: call[3] }))
    s.delivery.acknowledge({ type: 'session.thinking.appended', client_event_id: first[3] })
    s.delivery.acknowledge({ type: 'session.commentary.appended', client_event_id: 'other' })
    expect(s.delivery.pending).toBe(true)
    s.acknowledge()
    expect(s.delivery.pending).toBe(false)
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'answer_acknowledged' }))
})
test.each([true, false])('missing speech evidence never triggers a duplicate answer, acknowledged=%s', acknowledged => {
    const s = setup('Verified answer')
    s.tick()
    if (acknowledged) s.acknowledge()
    jest.advanceTimersByTime(6100)
    s.tick()
    jest.advanceTimersByTime(11000)
    s.tick()
    expect(s.append).toHaveBeenCalledTimes(1)
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'speech_unobserved' }))
    if (!acknowledged) expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'ack_timeout' }))
})
test('a correction before handoff cancels the queued answer and reconciles the new request', () => {
    const s = setup('Friday result')
    s.tick(Date.now())
    s.delivery.cancel()
    s.tick()
    expect(s.supersede).toHaveBeenCalledTimes(1)
    expect(s.append).not.toHaveBeenCalled()
})
test('waits for speech to finish before the end-call callback and never adds a second goodbye', () => {
    const s = setup('Goodbye!')
    s.tick()
    s.acknowledge()
    s.delivery.observeOutput()
    jest.advanceTimersByTime(5000)
    const lastSpeechAt = Date.now()
    s.tick(lastSpeechAt)
    expect(s.finish).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1600)
    s.tick(lastSpeechAt)
    expect(s.finish).toHaveBeenCalledTimes(1)
    expect(s.append).toHaveBeenCalledTimes(1)
})
test('records a disconnected handoff and ignores late acknowledgments', () => {
    const s = setup('Saved result')
    s.tick()
    s.delivery.close()
    s.acknowledge()
    jest.advanceTimersByTime(15000)
    s.tick()
    expect(s.record).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryStatus: 'call_closed_before_ack', deliveryCloseStage: 'answer' })
    )
    expect(s.append).toHaveBeenCalledTimes(1)
    expect(s.supersede).not.toHaveBeenCalled()
})
