import Popover from 'react-tiny-popover/dist/Popover'

describe('react-tiny-popover resize positioning', () => {
    let resizeCallback
    let originalResizeObserver
    let originalInnerHeight
    let originalInnerWidth

    beforeEach(() => {
        originalResizeObserver = global.ResizeObserver
        originalInnerHeight = window.innerHeight
        originalInnerWidth = window.innerWidth
        global.ResizeObserver = class ResizeObserver {
            constructor(callback) {
                resizeCallback = callback
            }
        }
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    })

    afterEach(() => {
        global.ResizeObserver = originalResizeObserver
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    })

    const createPopover = ({ rect, top, left, contentLocation }) => {
        const popover = new Popover({
            contentLocation,
            windowBorderPadding: 8,
        })
        popover.popoverDiv = {
            getBoundingClientRect: () => rect,
            style: { top, left },
        }
        return popover
    }

    it('moves dynamically resized content away from the top and left viewport edges', () => {
        const popover = createPopover({
            rect: { top: -32, left: -24, height: 100, width: 200 },
            top: '400px',
            left: '300px',
        })

        resizeCallback([])

        expect(popover.popoverDiv.style.top).toBe('440px')
        expect(popover.popoverDiv.style.left).toBe('332px')
    })

    it('moves dynamically resized content away from the bottom and right viewport edges', () => {
        const popover = createPopover({
            rect: { top: 550, left: 750, height: 100, width: 100 },
            top: '1000px',
            left: '900px',
        })

        resizeCallback([])

        expect(popover.popoverDiv.style.top).toBe('942px')
        expect(popover.popoverDiv.style.left).toBe('842px')
    })

    it('keeps an oversized popover aligned to the top-left viewport padding', () => {
        const popover = createPopover({
            rect: { top: -100, left: -200, height: 800, width: 1000 },
            top: '500px',
            left: '400px',
        })

        resizeCallback([])

        expect(popover.popoverDiv.style.top).toBe('608px')
        expect(popover.popoverDiv.style.left).toBe('608px')
    })

    it('reruns fixed contentLocation positioning instead of applying document offsets', () => {
        const popover = createPopover({
            rect: { top: -20, left: -20, height: 100, width: 100 },
            top: '200px',
            left: '200px',
            contentLocation: () => ({ top: 80, left: 100 }),
        })
        popover.renderPopover = jest.fn()

        resizeCallback([])

        expect(popover.renderPopover).toHaveBeenCalledTimes(1)
        expect(popover.popoverDiv.style).toEqual({ top: '200px', left: '200px' })
    })
})
