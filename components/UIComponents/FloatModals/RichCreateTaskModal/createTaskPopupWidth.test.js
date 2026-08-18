/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import useCreateTaskPopupWidth, { CREATE_TASK_WIDE_WIDTH } from './createTaskPopupWidth'
import useModalSizing from '../../../../hooks/useModalSizing'
import { MODAL_WIDTH_L } from '../../../styles/modals'

jest.mock('../../../../hooks/useModalSizing', () => jest.fn())

const renderHook = wide => {
    let result
    const Probe = () => {
        result = useCreateTaskPopupWidth(wide)
        return null
    }
    renderer.create(<Probe />)
    return result
}

describe('useCreateTaskPopupWidth (AT-2364)', () => {
    beforeEach(() => {
        useModalSizing.mockReturnValue({ width: MODAL_WIDTH_L, isSheet: false })
    })

    it('exposes the large modal token as the wide width', () => {
        expect(CREATE_TASK_WIDE_WIDTH).toBe(MODAL_WIDTH_L)
    })

    it('returns the wide width when requested on desktop', () => {
        expect(renderHook(true)).toEqual({
            width: MODAL_WIDTH_L,
            minWidth: MODAL_WIDTH_L,
            maxWidth: MODAL_WIDTH_L,
        })
        expect(useModalSizing).toHaveBeenCalledWith({ size: 'L' })
    })

    // The window clamp lives in useModalSizing, so a window too narrow for the
    // token must never produce a card wider than the viewport.
    it('takes the window-clamped width from the modal sizing hook', () => {
        useModalSizing.mockReturnValue({ width: 520, isSheet: false })

        expect(renderHook(true)).toEqual({ width: 520, minWidth: 520, maxWidth: 520 })
    })

    // A null override leaves the consumers' own applyPopoverWidth() in charge,
    // so every other add-task entry point keeps exactly the width it had.
    it('overrides nothing for every other add-task entry point', () => {
        expect(renderHook(false)).toBeNull()
        expect(renderHook(undefined)).toBeNull()
    })

    // Below MODAL_SHEET_BREAKPOINT AppPopover renders a full-width bottom
    // sheet, where a desktop width scale would only shrink the card.
    it('stands down in bottom-sheet presentation', () => {
        useModalSizing.mockReturnValue({ width: 360, isSheet: true })

        expect(renderHook(true)).toBeNull()
    })
})
