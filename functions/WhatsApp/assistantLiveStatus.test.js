const { voiceOperationOutcome, statusUpdate, formatLiveStatus } = require('./assistantLiveStatus')

test.each([
    { success: true, status: 200, text: 'Error messages and timeouts are the topic of this page' },
    { success: true, results: [] },
    { success: true, error: 'Old cached error', message: 'Everything returned' },
    { message: 'An error came in' },
    { content: [{ type: 'text', text: 'Permission denied' }], isError: false },
])('never infers an execution failure from successful results, empty results or untyped prose: %j', result => {
    expect(voiceOperationOutcome(result)).toEqual({ status: 'result_received', cause: null })
})

test.each([
    [{ success: false }, undefined],
    [{ status: 'failed' }, undefined],
    [{ success: false, error: { message: '' } }, undefined],
    [null, new Error('failed')],
    [null, new Error('An error occurred')],
    [{ success: false, message: 'Request failed' }, undefined],
    [null, new Error('Internal\n error')],
    [null, new Error()],
    [{ success: true, status: 'failed', error: 'Conflicting flags' }, undefined],
])('requires a specific cause as well as a failure signal: %j', (result, error) => {
    const outcome = voiceOperationOutcome(result, error)
    expect(outcome).toEqual({ status: 'outcome_unconfirmed', cause: null })
    expect(JSON.parse(formatLiveStatus({ ...outcome, step: 'Search' }))).toMatchObject({ error: null })
})

test.each([
    [{ success: false, error: 'Calendar write permission missing' }, undefined, 'Calendar write permission missing'],
    [null, new Error('Search request timed out'), 'Search request timed out'],
    [null, Object.assign(new Error(), { code: 'ECONNRESET' }), 'ECONNRESET'],
    [{ success: false, status: 429 }, undefined, 'HTTP 429'],
    [
        { isError: true, content: [{ type: 'text', text: 'Calendar authorization expired' }] },
        undefined,
        'Calendar authorization expired',
    ],
])('keeps real tool, transport and MCP failure causes: %j', (result, error, cause) => {
    const outcome = voiceOperationOutcome(result, error)
    expect(outcome).toEqual({ status: 'failed', cause })
    expect(JSON.parse(formatLiveStatus({ ...outcome, step: 'Requested lookup' })).error).toMatchObject({
        status: 'failed',
        cause,
    })
})

test.each(['confirmation_required', 'requires_auth', 'cancel_requested', 'request_changed', 'awaiting_user'])(
    '%s is a workflow state, not a technical error',
    status => {
        const outcome = voiceOperationOutcome({ success: false, status, error: 'Old timeout detail' })
        expect(outcome.status).not.toBe('failed')
        expect(outcome.cause).toBeNull()
    }
)

test('superseded speech is not a failure; free-form progress and bare urgent flags cannot announce errors', () => {
    expect(voiceOperationOutcome(null, new Error('voice_request_superseded'))).toEqual({
        status: 'cancelled',
        cause: null,
    })
    expect(statusUpdate('An error came in')).toBeNull()
    expect(statusUpdate({ content: 'An error came in', urgent: true })).toBeNull()
    const update = statusUpdate({
        status: 'running',
        step: 'Searching error reports',
        content: 'An error came in',
        cause: 'Made-up timeout',
        urgent: true,
    })
    expect(update).toMatchObject({ cause: null, urgent: false })
    expect(update.content).not.toContain('An error came in')
    expect(JSON.parse(formatLiveStatus(update)).error).toBeNull()
})

test('keeps status/cause together as valid bounded JSON, and removes credentials', () => {
    const update = statusUpdate({
        status: 'failed',
        step: '日'.repeat(200),
        scope: 'background:one',
        cause: 'Timeout Bearer secret-value https://private.example user@example.com ' + '\\"日'.repeat(200),
        active: ['📝'.repeat(300), 'Other lookup'],
        activeCount: 5,
    })
    for (const errorContextOnly of [false, true]) {
        const text = formatLiveStatus(update, { errorContextOnly })
        expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(480)
        const value = JSON.parse(text)
        expect(value).toMatchObject({
            scope: 'background:one',
            error: { status: 'failed', cause: expect.stringContaining('Timeout') },
        })
        expect(text).not.toMatch(/secret-value|private.example|user@example/)
    }
})
