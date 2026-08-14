/**
 * @jest-environment jsdom
 *
 * Contract for the AT-2189 patch in
 * replacement_node_modules/react-tiny-popover/dist/Popover.js.
 *
 * renderPopover walks the position priority order and recurses to the next
 * candidate whenever the current one "violates" the viewport. Upstream, running
 * off the end of that order returns without committing anything - but by then
 * renderWithPosition has already put popoverInfo into state, so render() has
 * mounted the portal (and whatever full-screen overlay the caller wraps it in)
 * while the container is still at its initial opacity 0 / top 0 / left 0, and an
 * active contentLocation helper is never called at all. The result is an
 * invisible popover that still swallows every tap.
 *
 * A popover that fits nowhere is normal on a phone: the swipe postpone popup
 * anchors to a zero-size target at the centre of the viewport, so a 305px-wide,
 * ~450px-tall modal violates all four candidates every single time.
 *
 * The patch keeps the search but commits the last candidate once the order is
 * exhausted. These tests pin both halves: still visible when nothing fits, and
 * byte-identical placement when something does.
 */
import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

const Popover = require('react-tiny-popover').default

const VIEWPORT_WIDTH = 390
const VIEWPORT_HEIGHT = 664

describe('react-tiny-popover with no fitting position', () => {
    let host
    let originalInnerWidth
    let originalInnerHeight

    const setViewport = (width, height) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }

    // jsdom has no layout. `content` is the natural size of the popover portal;
    // `target` is where the anchored element sits.
    const mockLayout = (content, target) => {
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
            if (this.classList && this.classList.contains('react-tiny-popover-container')) {
                const top = parseFloat(this.style.top) || 0
                const left = parseFloat(this.style.left) || 0
                return {
                    top,
                    left,
                    width: content.width,
                    height: content.height,
                    right: left + content.width,
                    bottom: top + content.height,
                }
            }
            return {
                top: target.top,
                left: target.left,
                width: 0,
                height: 0,
                right: target.left,
                bottom: target.top,
            }
        })
    }

    const render = extraProps => {
        const positionsTried = []
        act(() => {
            ReactDOM.render(
                <Popover
                    content={<div>modal</div>}
                    isOpen={true}
                    padding={4}
                    contentLocation={({ position }) => {
                        positionsTried.push(position)
                        return { top: 120, left: 43 }
                    }}
                    containerStyle={{ position: 'fixed' }}
                    {...extraProps}
                >
                    <span />
                </Popover>,
                host
            )
        })
        return { container: document.querySelector('.react-tiny-popover-container'), positionsTried }
    }

    beforeEach(() => {
        originalInnerWidth = window.innerWidth
        originalInnerHeight = window.innerHeight
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        window.getSelection = () => ({ toString: () => '' })
        setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
        host = document.createElement('div')
        document.body.appendChild(host)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(host)
        })
        host.remove()
        document.querySelectorAll('.react-tiny-popover-container').forEach(node => node.remove())
        jest.restoreAllMocks()
        setViewport(originalInnerWidth, originalInnerHeight)
    })

    const CENTRED_TARGET = { top: VIEWPORT_HEIGHT / 2, left: VIEWPORT_WIDTH / 2 }

    it('still commits a position, and calls contentLocation, when every candidate violates', () => {
        // 305x450 around the centre of a 390x664 phone: too wide to sit left or
        // right of the target, too tall to sit above or below it.
        mockLayout({ width: 305, height: 450 }, CENTRED_TARGET)

        const { container, positionsTried } = render()

        expect(container).not.toBeNull()
        expect(container.style.opacity).toBe('1')
        expect(positionsTried.length).toBeGreaterThan(0)
        expect(container.style.top).toBe('120px')
        expect(container.style.left).toBe('43px')
    })

    it('stays visible when the popover is larger than the whole viewport', () => {
        mockLayout({ width: 305, height: 900 }, CENTRED_TARGET)

        const { container } = render()

        expect(container.style.opacity).toBe('1')
    })

    it('leaves a popover that does find a viable position exactly where it was', () => {
        // Anchored near the top-left, so 'right' has room and the search stops
        // there - the pre-patch behaviour, which must be untouched.
        mockLayout({ width: 200, height: 100 }, { top: 40, left: 20 })

        const { container, positionsTried } = render()

        expect(container.style.opacity).toBe('1')
        expect(positionsTried[positionsTried.length - 1]).toBe('right')
    })

    it('does not search at all when the caller disables repositioning', () => {
        mockLayout({ width: 305, height: 450 }, CENTRED_TARGET)

        const { container, positionsTried } = render({ disableReposition: true })

        expect(container.style.opacity).toBe('1')
        expect(positionsTried[0]).toBe('top')
    })

    it('nudges a fixed portal inside the iOS safe area', () => {
        const nativeGetComputedStyle = window.getComputedStyle.bind(window)
        jest.spyOn(window, 'getComputedStyle').mockImplementation(element => {
            if (element.hasAttribute('data-safe-area-inset-probe')) {
                return { paddingTop: '47px', paddingRight: '7px', paddingBottom: '34px', paddingLeft: '11px' }
            }
            return nativeGetComputedStyle(element)
        })
        mockLayout({ width: 200, height: 100 }, CENTRED_TARGET)

        const { container } = render({
            contentLocation: () => ({ top: 0, left: 0 }),
        })

        // react-tiny-popover's default 6px windowBorderPadding remains in
        // addition to the physical iOS inset.
        expect(container.style.top).toBe('53px')
        expect(container.style.left).toBe('17px')
    })
})
