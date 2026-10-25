jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: { auth: () => ({ currentUser: { uid: 'u1' } }) },
}))
jest.mock('./backends/Users/reportNewDayStatisticsError', () => ({ reportNewDayStatisticsError: jest.fn() }))
import { recordNewDayEvent, flushNewDayDiagnostics } from './newDayDiagnostics'
import { reportNewDayStatisticsError } from './backends/Users/reportNewDayStatisticsError'

beforeEach(() => {
    localStorage.clear()
    reportNewDayStatisticsError.mockReset().mockResolvedValue(false)
})
const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
}

it('keeps the original reload time and reason for replay after navigation, without comment content', async () => {
    recordNewDayEvent('reload', { reason: 'daily-lifecycle', comment: 'private text', rating: 4 })
    await settle()
    const [, event] = reportNewDayStatisticsError.mock.calls[0]
    expect(event).toMatchObject({
        source: 'new-day-lifecycle',
        userId: 'u1',
        reason: 'daily-lifecycle',
        stage: 'reload',
        eventTime: expect.any(Number),
    })
    expect(JSON.stringify(event)).not.toContain('private text')
    reportNewDayStatisticsError.mockResolvedValue(true)
    await flushNewDayDiagnostics('u1')
    expect(reportNewDayStatisticsError.mock.calls[1][1]).toEqual(event)
    expect(localStorage.getItem('alldone.newDayDiagnostics.v1')).toBe('[]')
})

it('does not send an old account journal from a newly signed-in account', async () => {
    recordNewDayEvent('confirmation-local', { userId: 'u1', acknowledgedDate: 100 })
    await settle()
    reportNewDayStatisticsError.mockClear()
    await flushNewDayDiagnostics('u2')
    expect(reportNewDayStatisticsError).not.toHaveBeenCalled()
})

it('contains reporter failures and retains the event', async () => {
    reportNewDayStatisticsError.mockRejectedValue(new Error('transport failed'))
    recordNewDayEvent('reload', { reason: 'firestore-fatal_assertion' })
    await settle()
    await expect(flushNewDayDiagnostics('u1')).resolves.toBeUndefined()
    expect(JSON.parse(localStorage.getItem('alldone.newDayDiagnostics.v1'))).toHaveLength(1)
})
