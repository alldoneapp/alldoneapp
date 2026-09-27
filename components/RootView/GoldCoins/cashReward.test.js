jest.mock('../../SettingsView/Profile/Achievements/Skyline/webglSupport', () => ({ canRenderSkyline: () => true }))
jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({ currentReducedMotionPreference: () => false }))
const mockLaunchCash = jest.fn()
jest.mock('./loadGoldCoinsOverlay', () => ({
    loadGoldCoinsOverlay: () => Promise.resolve({ launchCash: mockLaunchCash }),
}))

const launchCash = mockLaunchCash
const { celebrateTaskEarnings } = require('./cashReward')

const project = { hourlyRatesData: { currency: 'EUR', hourlyRates: { me: 80 } } }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('celebrating money earned', () => {
    beforeEach(() => {
        launchCash.mockClear()
        document.body.innerHTML = '<div check-box-id="box-1"></div>'
    })

    it('throws the cash from the checkbox when the logged user earned money', async () => {
        celebrateTaskEarnings({ project, userId: 'me', loggedUserId: 'me', estimationMinutes: 30, checkBoxId: 'box-1' })
        await flush()
        expect(launchCash).toHaveBeenCalledTimes(1)
        expect(launchCash.mock.calls[0][0]).toMatchObject({ amount: 40, currency: 'EUR' })
        expect(launchCash.mock.calls[0][0].label).toMatch(/40/)
    })

    it('throws cash without a figure for every task on a day-rate project', async () => {
        const dayRate = { ...project, dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 4 } }
        celebrateTaskEarnings({
            project: dayRate,
            userId: 'me',
            loggedUserId: 'me',
            estimationMinutes: 0,
            checkBoxId: 'box-1',
        })
        await flush()
        expect(launchCash).toHaveBeenCalledTimes(1)
        expect(launchCash.mock.calls[0][0].label).toBeNull()
    })

    it('ignores the generated day-rate time log task', async () => {
        celebrateTaskEarnings({
            project: { ...project, dayRateTimeLog: { enabled: true } },
            userId: 'me',
            loggedUserId: 'me',
            estimationMinutes: 0,
            checkBoxId: 'box-1',
            generatedTimeLog: true,
        })
        await flush()
        expect(launchCash).not.toHaveBeenCalled()
    })

    it("does nothing for someone else's money, no rate, or no checkbox on screen", async () => {
        celebrateTaskEarnings({
            project,
            userId: 'me',
            loggedUserId: 'you',
            estimationMinutes: 30,
            checkBoxId: 'box-1',
        })
        celebrateTaskEarnings({ project, userId: 'me', loggedUserId: 'me', estimationMinutes: 0, checkBoxId: 'box-1' })
        celebrateTaskEarnings({
            project,
            userId: 'me',
            loggedUserId: 'me',
            estimationMinutes: 30,
            checkBoxId: 'missing',
        })
        await flush()
        expect(launchCash).not.toHaveBeenCalled()
    })
})
