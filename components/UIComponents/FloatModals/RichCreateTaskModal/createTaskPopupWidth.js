import useModalSizing from '../../../../hooks/useModalSizing'
import { MODAL_WIDTH_L } from '../../../styles/modals'

export const CREATE_TASK_POPUP_WIDTH = MODAL_WIDTH_L

/**
 * Width of every add-task popup (AT-2582).
 *
 * Task creation needs more horizontal room than the legacy 368/432px popover
 * width. Use the modal system's MODAL_WIDTH_L "large content" token for every
 * creation entry point on desktop and tablet.
 *
 * Two things this deliberately does:
 * - it resolves through useModalSizing, so the width is clamped to the window
 *   (a 700px-wide desktop window gets 640 only because it fits) AND reactive to
 *   resize/rotation, unlike applyPopoverWidth()'s one-shot Dimensions read;
 * - below MODAL_SHEET_BREAKPOINT it stands down: there AppPopover renders a
 *   full-width BottomSheet, where a desktop width scale is meaningless.
 *
 * The same style object is handed to the main form and to the in-place project
 * picker, so pressing "Select project" cannot make the popup jump width.
 */
export default function useCreateTaskPopupWidth(enabled = true) {
    const { width, isSheet } = useModalSizing({ size: 'L' })

    if (!enabled || isSheet || !width) return null

    return { width, minWidth: width, maxWidth: width }
}
