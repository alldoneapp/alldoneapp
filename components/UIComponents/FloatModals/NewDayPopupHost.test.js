/**
 * AT-3083 — the "A new day has begun" popup must show in App, Assistant and Both modes.
 *
 * Before, the popup sat in a pane-scoped WorkspaceOverlayLayer. Whenever the assistant hid the
 * Alldone pane (Assistant mode, Both on a phone or narrow window with the chat in front, the
 * browser/VM screen) that layer was `visibility: hidden`, so the popup was mounted, still held the
 * daily reload, and could not be seen. Now the host keeps App mode in the pane and puts Assistant
 * and Both over the whole window, with one instance for every layout.
 *
 * The overlay layer and the layout store are real; only the popup body is a stand-in, because
 * eligibility, timing and dismissal stay inside EndDayStatisticsModal (unchanged by AT-3083, see
 * __tests__/FloatModals/EndDayStatisticsModal.test.js).
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'

import NewDayPopupHost from './NewDayPopupHost'
import { setAnnaLayout } from '../../../utils/annaMode'
import { setWorkspaceViewport } from '../../../utils/workspaceViewport'

const mockMounted = jest.fn()
const mockUnmounted = jest.fn()
const mockRenderedProps = jest.fn()

jest.mock('./EndDayStatisticsModal', () => props => {
    const React = require('react')
    mockRenderedProps(props)
    React.useEffect(() => {
        mockMounted()
        return mockUnmounted
    }, [])
    return <button>Start new day</button>
})

const pane = { top: 60, left: 520, width: 920, height: 840 }
const layerOf = element => element.closest('[data-testid="workspace-overlay-layer"]')
const lastProps = () => mockRenderedProps.mock.calls[mockRenderedProps.mock.calls.length - 1][0]

// [mode, anna layout, pane rect published by AnnaShell, pane visible, expected full window]
const MODES = [
    ['App mode (plain Alldone, no strip)', 'alldone', null, true, false],
    ['App mode (desktop, below the assistant strip)', 'alldone', pane, true, false],
    ['Assistant mode (Alldone pane hidden)', 'chat', pane, false, true],
    ['Assistant mode (a screen picked in the chat card)', 'chat', pane, true, true],
    ['Both mode (desktop, Alldone beside the chat)', 'split', pane, true, true],
    ['Both mode (phone or narrow window, chat in front)', 'split', pane, false, true],
]

const applyMode = (layout, rect, visible) => {
    setAnnaLayout(layout)
    setWorkspaceViewport(rect, visible)
}

beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState({}, '', '/projects/tasks/open')
})

afterEach(() => {
    cleanup()
    setWorkspaceViewport(null)
    setAnnaLayout('alldone')
    localStorage.clear()
})

it.each(MODES)('shows exactly one visible New Day popup in %s', (_name, layout, rect, visible, fullWindow) => {
    applyMode(layout, rect, visible)
    render(<NewDayPopupHost />)

    const button = screen.getByText('Start new day')
    const layer = layerOf(button)
    expect(screen.getAllByText('Start new day')).toHaveLength(1)
    expect(layer.getAttribute('aria-hidden')).toBeNull()
    expect(getComputedStyle(layer).visibility).not.toBe('hidden')
    expect(lastProps()).toEqual({ fullWindow })
    // Whole window: the layer adds no containing block of its own. App mode keeps the pane.
    expect(getComputedStyle(layer).display).toBe(fullWindow || !rect ? 'contents' : 'flex')
})

it('keeps App mode in the Alldone pane exactly as before', () => {
    applyMode('alldone', pane, true)
    render(<NewDayPopupHost />)

    const layer = layerOf(screen.getByText('Start new day'))
    expect(layer.style.position).toBe('fixed')
    expect(layer.style.left).toBe(`${pane.left}px`)
    expect(layer.style.top).toBe(`${pane.top}px`)
    expect(layer.style.width).toBe(`${pane.width}px`)
    expect(lastProps()).toEqual({ fullWindow: false })
})

it('covers the whole window in Both mode even while the Alldone pane is visible beside the chat', () => {
    applyMode('split', pane, true)
    render(<NewDayPopupHost />)

    const layer = layerOf(screen.getByText('Start new day'))
    expect(layer.style.position).not.toBe('fixed')
    expect(layer.style.left).toBe('')
    expect(getComputedStyle(layer).display).toBe('contents')
})

it('keeps one instance, never remounted or duplicated, across App, Assistant and Both', () => {
    applyMode('alldone', null, true)
    render(<NewDayPopupHost />)
    const button = screen.getByText('Start new day')

    for (const [, layout, rect, visible, fullWindow] of [...MODES, ...MODES.slice().reverse()]) {
        act(() => applyMode(layout, rect, visible))
        expect(screen.getAllByText('Start new day')).toHaveLength(1)
        expect(screen.getByText('Start new day')).toBe(button)
        expect(layerOf(button).getAttribute('aria-hidden')).toBeNull()
        expect(lastProps()).toEqual({ fullWindow })
    }
    expect(mockMounted).toHaveBeenCalledTimes(1)
    expect(mockUnmounted).not.toHaveBeenCalled()
})
