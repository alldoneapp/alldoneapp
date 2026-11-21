import React, { useRef } from 'react'
import { render } from '@testing-library/react'

import useAnnaChatWidth from './useAnnaChatWidth'

const originalWidth = window.innerWidth
let result
const Probe = () => {
    const layout = useRef(null)
    result = useAnnaChatWidth('u1', layout)
    return <main ref={layout} />
}
// The chat card's measured width; jsdom lays nothing out.
let layoutWidth
beforeEach(() => {
    window.innerWidth = 1200
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return { width: this.tagName === 'MAIN' ? layoutWidth : 0 }
    })
})
afterEach(() => {
    window.innerWidth = originalWidth
    jest.restoreAllMocks()
})

/**
 * AT-3121: Anna alone beside the "Anna on top" sidebar keeps Alldone's side margins, which narrow her
 * card by far more than the one card's 10px gutters. Both must still open where it did, so that room
 * counts as available.
 */
describe('useAnnaChatWidth with Anna alone beside the shell sidebar', () => {
    // A 1200px window, the sidebar collapsed (56px): 936px with Alldone's 104px margins, 1124px with
    // the one card's 10px gutters.
    it('counts Alldone’s side margins as room for the chat beside Alldone', () => {
        layoutWidth = 936
        render(
            <div
                className="anna-shell anna-shell-owns-sidebar anna-chat-only"
                style={{ '--anna-shell-content-margin': '104px' }}
            >
                <Probe />
            </div>
        )
        expect(result.splitFits).toBe(true)
        expect(result.windowWidth).toBe(1200)
    })

    it('adds nothing in the other layouts', () => {
        layoutWidth = 936
        render(
            <div className="anna-shell anna-chat-only" style={{ '--anna-shell-content-margin': '104px' }}>
                <Probe />
            </div>
        )
        expect(result.splitFits).toBe(false)
    })
})
