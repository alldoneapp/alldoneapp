import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import AnnaTopStrip from './AnnaTopStrip'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }))
jest.mock('../TopBar/ConnectionStatusChip', () => () => null)
jest.mock('../TopBar/NotificationArea', () => () => null)
jest.mock('./AnnaViewSwitch', () => () => null)
jest.mock('../Icon', () => () => null)
const mockNavigateToHome = jest.fn()
jest.mock(
    '../../utils/navigateToHome',
    () =>
        (...args) =>
            mockNavigateToHome(...args)
)
let mockStatistics = null
jest.mock('../TopBar/TopBarStatisticArea', () => props => {
    mockStatistics = props
    return null
})

// What the statistics need with what they show: the XP bar, labels, the done-task count.
const neededFor = ({ showXp, compact, showTasksStatistics }) =>
    120 + (showXp ? 100 : 0) + (compact ? 0 : 200) + (showTasksStatistics ? 60 : 0)

let room = 0
let container
let root
// The strip takes a step back only when its left side changes size: a ResizeObserver stand-in.
let resizeCallbacks = []
class FakeResizeObserver {
    constructor(callback) {
        this.callback = callback
    }
    observe() {
        resizeCallbacks.push(this.callback)
    }
    disconnect() {
        resizeCallbacks = resizeCallbacks.filter(callback => callback !== this.callback)
    }
}
const resizeTo = width =>
    act(() => {
        room = width
        resizeCallbacks.forEach(callback => callback())
    })
const render = () =>
    act(() => root.render(<AnnaTopStrip layout="alldone" canSplit assistantName="Anna" onSelect={() => {}} />))

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    resizeCallbacks = []
    global.ResizeObserver = FakeResizeObserver
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
        return this.classList.contains('anna-strip-left') ? room : 0
    })
    jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
        return this.classList.contains('anna-strip-left') ? Math.max(room, neededFor(mockStatistics)) : 0
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.restoreAllMocks()
    delete global.ResizeObserver
})

describe('the strip’s statistics when short of room', () => {
    it('shows everything where it fits', () => {
        room = 600
        render()
        expect(mockStatistics).toEqual({ showXp: true, compact: false, showTasksStatistics: true })
    })

    it('drops the XP bar first, then the labels, then the done-task count, and takes them back', () => {
        // Everything needs 480, without the XP bar 380, with icons 180, without the count 120.
        room = 400
        render()
        expect(mockStatistics).toEqual({ showXp: false, compact: false, showTasksStatistics: true })

        resizeTo(450)
        // Not yet the 480 the XP bar needed: it stays away, so nothing flickers.
        expect(mockStatistics).toEqual({ showXp: false, compact: false, showTasksStatistics: true })

        resizeTo(300)
        expect(mockStatistics).toEqual({ showXp: false, compact: true, showTasksStatistics: true })

        resizeTo(150)
        expect(mockStatistics).toEqual({ showXp: false, compact: true, showTasksStatistics: false })

        // One size change takes back every step the side is wide enough for.
        resizeTo(1000)
        expect(mockStatistics).toEqual({ showXp: true, compact: false, showTasksStatistics: true })
    })

    it('never takes a step back on a mere re-render', () => {
        room = 400
        render()
        expect(mockStatistics.showXp).toBe(false)
        room = 1000
        render()
        render()
        expect(mockStatistics.showXp).toBe(false)
    })
})

// Where the strip spans the window, it starts with Alldone's logo, which opens All projects like the
// sidebar's, in the view the person chose; in Alldone's top bar slot the sidebar's logo is beside it.
describe('the strip’s logo', () => {
    const logo = () => container.querySelector('.anna-strip-logo')
    const renderWith = props =>
        act(() =>
            root.render(<AnnaTopStrip layout="alldone" canSplit assistantName="Anna" onSelect={() => {}} {...props} />)
        )

    it('shows only where the strip spans the window, and opens All projects', () => {
        room = 1000
        renderWith({})
        expect(logo()).toBeNull()
        renderWith({ showLogo: true })
        expect(logo().getAttribute('aria-label')).toBe('Alldone.app')
        act(() => logo().click())
        expect(mockNavigateToHome).toHaveBeenCalledTimes(1)
    })

    it('keeps the view: unlike the rest of the left side, it does not leave the chat', () => {
        room = 1000
        const onLeaveChat = jest.fn()
        renderWith({ showLogo: true, onLeaveChat })
        act(() => logo().click())
        expect(mockNavigateToHome).toHaveBeenCalled()
        expect(onLeaveChat).not.toHaveBeenCalled()
        // Anything else on the left still leaves it.
        act(() => logo().parentElement.click())
        expect(onLeaveChat).toHaveBeenCalledTimes(1)
    })
})
