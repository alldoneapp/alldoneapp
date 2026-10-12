import React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import useModalSizing from '../hooks/useModalSizing'
import useWorkspaceViewport, { useWorkspaceViewportOwner } from '../hooks/useWorkspaceViewport'
import { centerPopoverInWindow, pinPopoverInsideWindow } from './popoverPositioning'
import { getSafeAreaModalMaxHeightBelow } from './modalSafeArea'
import {
    getWorkspaceViewport,
    setWorkspaceViewport,
    getWorkspaceInsets,
    getWorkspaceKeyboardInset,
    WORKSPACE_VIEWPORT_EVENT,
} from './workspaceViewport'

const pane = { left: 520, top: 72, width: 920, height: 828 }
let sizing
function Probe() {
    sizing = useModalSizing({ size: 'XL' })
    useWorkspaceViewport()
    return null
}

const originalWidth = window.innerWidth
const originalHeight = window.innerHeight
beforeEach(() => {
    window.innerWidth = 1440
    window.innerHeight = 900
})
afterEach(() => {
    cleanup()
    setWorkspaceViewport(null)
    window.innerWidth = originalWidth
    window.innerHeight = originalHeight
})

it('centers and pins portals in browser coordinates inside Alldone', () => {
    setWorkspaceViewport(pane)
    const args = { popoverRect: { width: 400, height: 200 } }
    expect(centerPopoverInWindow(args)).toEqual({ left: 780, top: 386 })
    expect(pinPopoverInsideWindow(args, { left: 16, top: 60 })).toEqual({ left: 536, top: 132 })
    expect(getSafeAreaModalMaxHeightBelow(900, 600)).toBe(268)
})

it('resizes an already open modal with the divider and restores fullscreen sizing', () => {
    render(<Probe />)
    expect(sizing.windowWidth).toBe(1440)
    act(() => setWorkspaceViewport(pane))
    expect(sizing.windowHeight).toBe(828)
    expect(sizing.width).toBe(800)
    expect(sizing.isSheet).toBe(false)
    act(() => setWorkspaceViewport({ ...pane, left: 900, width: 540 }))
    expect(sizing.isSheet).toBe(true)
    expect(sizing.width).toBe(508)
    expect(sizing.portalInsets).toEqual({ left: 900, top: 72, bottom: 0, right: 0 })
    act(() => setWorkspaceViewport(null))
    expect(sizing.isSheet).toBe(false)
    expect(sizing.windowWidth).toBe(1440)
    expect(sizing.portalInsets).toEqual({ left: 0, top: 0, bottom: 0, right: 0 })
})

it('counts only system UI and keyboard space that actually overlaps the pane', () => {
    setWorkspaceViewport({ ...pane, height: 528 })
    expect(getWorkspaceInsets({ top: 59, left: 44, bottom: 34, right: 20 })).toEqual({
        top: 0,
        left: 0,
        bottom: 0,
        right: 20,
    })
    expect(getWorkspaceKeyboardInset(300)).toBe(0)
    expect(getWorkspaceKeyboardInset(350)).toBe(50)
})

it('observes the actual pane and releases its geometry on zoom-in or unmount', () => {
    let resize
    const originalObserver = global.ResizeObserver
    const disconnect = jest.fn()
    global.ResizeObserver = class {
        constructor(callback) {
            resize = callback
        }
        observe() {}
        disconnect = disconnect
    }
    const ref = { current: { getBoundingClientRect: () => pane } }
    function Owner({ active }) {
        useWorkspaceViewportOwner(ref, active)
        return null
    }
    try {
        const view = render(<Owner active />)
        expect(getWorkspaceViewport()).toMatchObject(pane)
        ref.current.getBoundingClientRect = () => ({ ...pane, width: 600 })
        act(() => resize())
        expect(getWorkspaceViewport().width).toBe(600)
        view.rerender(<Owner active={false} />)
        expect(getWorkspaceViewport().active).toBe(false)
        expect(disconnect).toHaveBeenCalledTimes(1)
        view.rerender(<Owner active />)
        view.unmount()
        expect(getWorkspaceViewport().active).toBe(false)
    } finally {
        global.ResizeObserver = originalObserver
    }
})

it('does not repeatedly notify unchanged geometry', () => {
    const listener = jest.fn()
    window.addEventListener(WORKSPACE_VIEWPORT_EVENT, listener)
    setWorkspaceViewport(pane)
    setWorkspaceViewport({ ...pane })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(WORKSPACE_VIEWPORT_EVENT, listener)
})
