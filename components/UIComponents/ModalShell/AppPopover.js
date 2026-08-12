import React from 'react'
import Popover from 'react-tiny-popover'

import BottomSheet from './BottomSheet'
import useModalSizing from '../../../hooks/useModalSizing'

/**
 * Drop-in replacement for a direct react-tiny-popover usage
 * (MODAL_IMPROVEMENT_PLAN.md, Phase 2): below MODAL_SHEET_BREAKPOINT the
 * content renders as a BottomSheet; everywhere else the vendored Popover is
 * used untouched, with every prop passed through. Migrating a popup =
 * swapping the <Popover> tag for <AppPopover> in its trigger wrapper.
 *
 * In sheet mode `position`, `align`, `padding` and `contentLocation` are
 * meaningless and ignored; `onClickOutside` doubles as the sheet's close
 * request (backdrop tap / Escape / drag affordance).
 */
export default function AppPopover({ content, children, isOpen, onClickOutside, modalId, ...popoverProps }) {
    const { isSheet } = useModalSizing()

    if (!isSheet) {
        return (
            <Popover content={content} isOpen={isOpen} onClickOutside={onClickOutside} {...popoverProps}>
                {children}
            </Popover>
        )
    }

    return (
        <>
            {children}
            <BottomSheet isOpen={!!isOpen} onRequestClose={onClickOutside} modalId={modalId}>
                {typeof content === 'function' ? content({ position: 'bottom', align: 'center' }) : content}
            </BottomSheet>
        </>
    )
}
