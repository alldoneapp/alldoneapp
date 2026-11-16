import { findWorkspaceObject, scrollWorkspaceObject, workspaceContentTop } from './annaWorkspaceRevealTargets'
import { scrollToTaskWhenShown } from './annaFocusTaskScroll'

jest.mock('./annaWorkspaceRevealTargets', () => ({
    findWorkspaceObject: jest.fn(),
    scrollWorkspaceObject: jest.fn(),
    workspaceContentTop: jest.fn(),
}))

let root
const row = { id: 'row' }
const target = { taskId: 't1', projectId: 'p1' }

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    root = document.createElement('div')
    document.body.append(root)
    workspaceContentTop.mockReturnValue(1200)
})
afterEach(() => {
    root.remove()
    jest.useRealTimers()
})

// The header's focus task opens the task list, whose rows mount after the navigation.
describe('scrollToTaskWhenShown', () => {
    it('waits for the focus task’s row and centres it, even when it is already in view', () => {
        findWorkspaceObject.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValue(row)
        scrollToTaskWhenShown(root, target)
        jest.advanceTimersByTime(0)
        expect(scrollWorkspaceObject).not.toHaveBeenCalled()
        jest.advanceTimersByTime(200)
        expect(findWorkspaceObject).toHaveBeenCalledWith(root, { type: 'task', objectId: 't1', projectId: 'p1' })
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
        expect(scrollWorkspaceObject).toHaveBeenCalledWith(row, root, false, { center: true })
        // The row holds still: no second scroll, and it stops looking once settled.
        jest.advanceTimersByTime(1100)
        const looks = findWorkspaceObject.mock.calls.length
        jest.advanceTimersByTime(2000)
        expect(findWorkspaceObject.mock.calls.length).toBe(looks)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
    })

    it('centres it again while the list above it keeps loading and pushes it down', () => {
        findWorkspaceObject.mockReturnValue(row)
        scrollToTaskWhenShown(root, target)
        jest.advanceTimersByTime(0)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
        // A section above arrives: the row moves down in the list.
        workspaceContentTop.mockReturnValue(1650)
        jest.advanceTimersByTime(300)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(2)
        // A few pixels are no move.
        workspaceContentTop.mockReturnValue(1652)
        jest.advanceTimersByTime(300)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(2)
    })

    it('never moves the list again once the person scrolls, clicks or types in it', () => {
        findWorkspaceObject.mockReturnValue(row)
        scrollToTaskWhenShown(root, target)
        jest.advanceTimersByTime(0)
        expect(scrollWorkspaceObject).toHaveBeenCalledTimes(1)
        root.dispatchEvent(new Event('wheel'))
        workspaceContentTop.mockReturnValue(1650)
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
