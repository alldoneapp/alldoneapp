import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useModalSizing from './useModalSizing'
import { MODAL_EDGE_GAP, MODAL_SHEET_BREAKPOINT, MODAL_WIDTH_M, MODAL_WIDTH_S } from '../components/styles/modals'

let latest

function Probe(props) {
    latest = useModalSizing(props)
    return null
}

const renderProbe = props => {
    let tree
    act(() => {
        tree = renderer.create(<Probe {...props} />)
    })
    return tree
}

const setWindowSize = (width, height) => {
    window.innerWidth = width
    window.innerHeight = height
    act(() => {
        window.dispatchEvent(new Event('resize'))
    })
}

describe('useModalSizing', () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight

    afterEach(() => {
        window.innerWidth = originalInnerWidth
        window.innerHeight = originalInnerHeight
        delete window.visualViewport
        latest = undefined
    })

    it('uses the width scale on desktop and is not a sheet', () => {
        window.innerWidth = 1024
        window.innerHeight = 768
        const tree = renderProbe()
        expect(latest.isSheet).toBe(false)
        expect(latest.width).toBe(MODAL_WIDTH_M)
        expect(latest.maxHeight).toBe(768 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })

    it('honors the requested size on desktop', () => {
        window.innerWidth = 1024
        window.innerHeight = 768
        const tree = renderProbe({ size: 'S' })
        expect(latest.width).toBe(MODAL_WIDTH_S)
        tree.unmount()
    })

    it('goes full width below the sheet breakpoint', () => {
        window.innerWidth = MODAL_SHEET_BREAKPOINT - 140
        window.innerHeight = 700
        const tree = renderProbe()
        expect(latest.isSheet).toBe(true)
        expect(latest.width).toBe(MODAL_SHEET_BREAKPOINT - 140 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })

    it('clamps a large size to the window on narrow desktops', () => {
        window.innerWidth = 700
        window.innerHeight = 700
        const tree = renderProbe({ size: 'XL' })
        expect(latest.isSheet).toBe(false)
        expect(latest.width).toBe(700 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })

    it('reacts to window resize', () => {
        window.innerWidth = 1024
        window.innerHeight = 768
        const tree = renderProbe()
        expect(latest.isSheet).toBe(false)
        setWindowSize(500, 700)
        expect(latest.isSheet).toBe(true)
        expect(latest.width).toBe(500 - MODAL_EDGE_GAP * 2)
        expect(latest.maxHeight).toBe(700 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })

    it('subtracts the visual-viewport keyboard inset from maxHeight and follows its changes', () => {
        const listeners = {}
        window.innerWidth = 390
        window.innerHeight = 800
        window.visualViewport = {
            height: 400,
            offsetTop: 0,
            addEventListener: (type, cb) => {
                listeners[type] = cb
            },
            removeEventListener: () => {},
        }
        const tree = renderProbe()
        // inset = 800 - (400 + 0) = 400 >= the open threshold
        expect(latest.keyboardInset).toBe(400)
        expect(latest.maxHeight).toBe(800 - 400 - MODAL_EDGE_GAP * 2)

        window.visualViewport.height = 800
        act(() => {
            listeners.resize()
        })
        expect(latest.keyboardInset).toBe(0)
        expect(latest.maxHeight).toBe(800 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })

    it('treats a small inset (collapsing URL bar) as no keyboard', () => {
        window.innerWidth = 390
        window.innerHeight = 800
        window.visualViewport = {
            height: 750,
            offsetTop: 0,
            addEventListener: () => {},
            removeEventListener: () => {},
        }
        const tree = renderProbe()
        expect(latest.keyboardInset).toBe(0)
        expect(latest.maxHeight).toBe(800 - MODAL_EDGE_GAP * 2)
        tree.unmount()
    })
})
