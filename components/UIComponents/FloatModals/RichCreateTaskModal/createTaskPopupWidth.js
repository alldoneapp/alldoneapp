import useModalSizing from '../../../../hooks/useModalSizing'
import { MODAL_WIDTH_L } from '../../../styles/modals'

export const CREATE_TASK_WIDE_WIDTH = MODAL_WIDTH_L

/**
 * Width of the add-task popup (AT-2364).
 *
 * The big "Add task" call to action on the All Projects empty inbox is the only
 * add-task entry point that is itself centered on the screen, and it is the
 * first thing a new user presses — so its popup opens WIDE (the modal system's
 * MODAL_WIDTH_L "large content" token) instead of the legacy 432px card. Every
 * other entry point keeps applyPopoverWidth() untouched.
 *
 * Returns `null` when the popup should keep its existing width — the consumers
 * apply this as an OVERRIDE on top of their own applyPopoverWidth(), so a null
 * result leaves every other add-task entry point byte-identical to before.
 *
 * Two things this deliberately does:
 * - it resolves through useModalSizing, so the width is clamped to the window
 *   (a 700px-wide desktop window gets 640 only because it fits) AND reactive to
 *   resize/rotation, unlike applyPopoverWidth()'s one-shot Dimensions read;
 * - below MODAL_SHEET_BREAKPOINT it stands down: there AppPopover renders a
 *   full-width BottomSheet, where a desktop width scale is meaningless.
 *
 * The SAME style object is handed to the main form and to the in-place project
 * picker, so pressing "Select project" cannot make the popup jump width.
 */
export default function useCreateTaskPopupWidth(wide) {
    const { width, isSheet } = useModalSizing({ size: 'L' })

    if (!wide || isSheet || !width) return null

    return { width, minWidth: width, maxWidth: width }
}
