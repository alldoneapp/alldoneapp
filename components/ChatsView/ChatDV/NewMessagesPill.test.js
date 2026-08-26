import fs from 'fs'
import path from 'path'
import React from 'react'
import { StyleSheet } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import NewMessagesPill from './NewMessagesPill'
import {
    CHAT_BOARD_CONTENT_OFFSET,
    CHAT_COMPOSER_LIFT,
    getChatComposerLift,
    getNewMessagesPillBottom,
} from './chatComposerLayout'

jest.mock('../../../hooks/useHomeIndicatorLift')
import useHomeIndicatorLift from '../../../hooks/useHomeIndicatorLift'

jest.mock('../../Icon', () => () => null)

// AT-2439 follow-up - the pill was rendering half behind the composer (and slightly left of it).
// These drive the REAL component, so they are about the style it actually ships rather than about
// the constants it happens to import.
describe('NewMessagesPill placement', () => {
    beforeEach(() => {
        useHomeIndicatorLift.mockReturnValue(0)
    })

    const render = () => {
        let tree
        act(() => {
            tree = TestRenderer.create(<NewMessagesPill onPress={() => {}} />)
        })
        return tree
    }

    // The strip is the absolutely positioned container; the pill is the touchable inside it.
    const strip = tree => StyleSheet.flatten(tree.root.children[0].props.style)

    const pillNode = tree =>
        tree.root.findAll(node => node.props?.accessibilityLabel === 'Jump to newest message', { deep: false })[0]

    it('floats over the thread instead of taking part in its layout', () => {
        // A pill that pushed the thread down would move the text the reader is mid-sentence in —
        // the exact thing the auto-scroll pin is careful not to do.
        expect(strip(render()).position).toBe('absolute')
    })

    it('sits above the composer, not underneath it', () => {
        // The defect: `bottom: 12` was measured from the scroller's FLOW edge, which is 24px below
        // the composer's painted top edge, so the composer drew over the pill's lower half.
        expect(strip(render()).bottom).toBeGreaterThan(CHAT_COMPOSER_LIFT)
        expect(strip(render()).bottom).toBe(getNewMessagesPillBottom(0))
    })

    it('centres on the composer rather than on the leftward-shifted message column', () => {
        const style = strip(render())
        expect(style.alignItems).toBe('center')
        // ChatBoard pulls the scroller 13px left; the composer is not pulled with it, so a strip
        // spanning the scroller centres 6.5px left of the frame it is supposed to sit above.
        expect(style.left).toBe(CHAT_BOARD_CONTENT_OFFSET)
        expect(style.right).toBe(0)
    })

    it('follows the composer up on an iOS standalone PWA', () => {
        // ChatInput lifts itself over the home indicator; a pill that stayed put would be hidden
        // again on exactly that surface.
        useHomeIndicatorLift.mockReturnValue(34)
        expect(strip(render()).bottom).toBe(getNewMessagesPillBottom(34))
        expect(strip(render()).bottom).toBeGreaterThan(getChatComposerLift(34))
    })

    it('lets taps through to the messages behind the strip, but not through the pill', () => {
        // The strip spans the full width; only the pill itself is meant to be clickable.
        expect(strip(render()).pointerEvents).toBe('none')
        expect(StyleSheet.flatten(pillNode(render()).props.style).pointerEvents).toBe('auto')
    })

    it('still calls back when pressed', () => {
        const onPress = jest.fn()
        let tree
        act(() => {
            tree = TestRenderer.create(<NewMessagesPill onPress={onPress} />)
        })
        act(() => {
            tree.root
                .findAll(node => node.props?.accessibilityLabel === 'Jump to newest message', { deep: false })[0]
                .props.onPress()
        })
        expect(onPress).toHaveBeenCalledTimes(1)
    })
})

// The pill's position is only correct relative to a number that lives in another component. A
// literal at either end is what shipped the bug, and it would not fail any behavioural test —
// so the shared source is ratcheted directly.
describe('the composer lift has a single source', () => {
    const readSource = relativePath => fs.readFileSync(path.join(__dirname, relativePath), 'utf8')

    it('ChatInput takes its offset from chatComposerLayout', () => {
        const source = readSource('./EditorView/ChatInput.js')
        expect(source).toContain("from '../chatComposerLayout'")
        // The two spellings the old code used, both of which the pill could not see.
        expect(source).not.toMatch(/bottom:\s*24\b/)
        expect(source).not.toMatch(/bottom:\s*24\s*\+/)
    })

    it('the pill takes its offset from the same module', () => {
        const source = readSource('./NewMessagesPill.js')
        expect(source).toContain("from './chatComposerLayout'")
        expect(source).not.toMatch(/bottom:\s*\d/)
    })

    it('ChatBoard shares the margin the pill cancels', () => {
        expect(readSource('./ChatBoard.js')).toContain('marginLeft: -CHAT_BOARD_CONTENT_OFFSET')
    })
})
