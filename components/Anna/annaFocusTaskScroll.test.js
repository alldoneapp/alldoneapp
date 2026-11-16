import { findWorkspaceObject, scrollWorkspaceObject } from './annaWorkspaceRevealTargets'
import { scrollToTaskWhenShown } from './annaFocusTaskScroll'

jest.mock('./annaWorkspaceRevealTargets', () => ({
    findWorkspaceObject: jest.fn(),
    scrollWorkspaceObject: jest.fn(),
}))

const root = {}
const row = { id: 'row' }
const target = { taskId: 't1', projectId: 'p1' }

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

// The header's focus task opens the task list, whose rows mount after the navigation.
describe('scrollToTaskWhenShown', () => {
    it('waits for the focus task’s row and scrolls Alldone to it once', () => {
        findWorkspaceObject.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValue(row)
        scrollToTaskWhenShown(root, target)
        jest.advanceTimersByTime(0)
        expect(scrollWorkspaceObject).not.toHaveBeenCalled()
        jest.advanceTimersByTime(200)
        expect(findWorkspaceObject).toHaveBeenCalledWith(root, { type: 'task', objectId: 't1', projectId: 'p1' })
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
        expect(scrollWorkspaceObject).toHaveBeenCalledWith(row, root, false)
        jest.advanceTimersByTime(1000)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
    })

    it('gives up when the row never shows, and stops when cancelled', () => {
        findWorkspaceObject.mockReturnValue(null)
        scrollToTaskWhenShown(root, target, { timeout: 500 })
        jest.advanceTimersByTime(2000)
        const tries = findWorkspaceObject.mock.calls.length
        expect(tries).toBeGreaterThan(1)
        expect(tries).toBeLessThan(10)

        findWorkspaceObject.mockClear()
        const cancel = scrollToTaskWhenShown(root, target)
        cancel()
        jest.advanceTimersByTime(1000)
        expect(findWorkspaceObject).not.toHaveBeenCalled()
        expect(scrollWorkspaceObject).not.toHaveBeenCalled()
    })
})
