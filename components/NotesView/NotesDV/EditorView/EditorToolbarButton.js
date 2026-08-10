import React, { useCallback } from 'react'
import { View } from 'react-native'

/**
 * A note-toolbar button.
 *
 * `mousedown` is prevented by default so pressing a toolbar button never moves
 * DOM focus out of the Quill editor. That is the standard rich-text toolbar
 * pattern, and it is what keeps the user's text selection alive (and visibly
 * highlighted) while the action runs: without it the browser blurs the
 * contenteditable on press, Quill immediately reports a `null` selection, and
 * every action that works on "the selected text" - Task, Comment, Date - has to
 * guess. Click still fires normally; only the focus/selection side effect of
 * the press is suppressed. A caller-supplied `onMouseDown` still runs.
 */
const EditorToolbarButton = ({ children, onMouseDown, ...buttonProps }) => {
    const handleMouseDown = useCallback(
        event => {
            // Keep the editor focused and its selection intact.
            event.preventDefault()
            if (onMouseDown) onMouseDown(event)
        },
        [onMouseDown]
    )

    return (
        <button {...buttonProps} onMouseDown={handleMouseDown}>
            <View style={{ flexDirection: 'row', maxHeight: 20 }}>{children}</View>
        </button>
    )
}

export default EditorToolbarButton
