/**
 * AT-3028 — the assistant line's blank second line must take a click and start typing.
 *
 * Rebuilds the composer's text field from shipped parts: a REAL Quill (react-quill-new, as
 * CustomTextInput3 uses), the app's global Quill CSS, CustomTextInput3's `styles.css` and the
 * composer's own `assistantInput.css`, the classes and the auto-expand `height: auto` that
 * CustomTextInput3 applies, react-native-web Views for the frame (56px, 4px/8px padding, exactly
 * as `AssistantOptions` + `assistantInputLayout.js` size it), and the REAL mousedown handler.
 *
 * CustomTextInput3 itself is not mounted: its import graph is the whole backend. What decides this
 * bug is layout (where the contenteditable ends) and event routing, and both are real here.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'
import ReactQuill from 'react-quill-new'

import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'
import '../../components/Feeds/CommentsTextInput/styles.css'
import '../../components/MyDayView/AssistantLine/assistantInput.css'
import { handleComposerFieldMouseDown } from '../../components/MyDayView/AssistantLine/assistantComposerFocus'
import {
    ASSISTANT_INPUT_MIN_HEIGHT,
    ASSISTANT_INPUT_VERTICAL_PADDING,
} from '../../components/MyDayView/AssistantLine/assistantInputLayout'

window.toolbarPresses = []

function Composer() {
    const reactQuill = useRef(null)
    const [ready, setReady] = useState(false)
    const input = useRef(null)

    useEffect(() => {
        const quill = reactQuill.current.getEditor()
        const container = quill.container
        const editor = quill.root
        // What CustomTextInput3 does for TASK_THEME + autoExpand.
        container.classList.add('ql-textInputContainer', 'ql-taskTextInputContainer')
        editor.classList.add('ql-textInputEditor', 'ql-taskTextInputEditor')
        container.style.height = 'auto'
        editor.style.height = 'auto'
        editor.style.overflowY = 'visible'
        input.current = {
            getEditor: () => quill,
            focus: () => quill.focus(),
            isFocused: () => quill.hasFocus(),
        }
        window.quill = quill
        setReady(true)
    }, [])

    const press = name => () => window.toolbarPresses.push(name)

    return (
        <View
            testID="assistant-composer-row"
            style={{
                width: 560,
                margin: 40,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#d0d5dd',
                paddingTop: 8,
                paddingBottom: 6,
                paddingHorizontal: 6,
            }}
        >
            <View
                testID="assistant-composer-field"
                onMouseDown={event => handleComposerFieldMouseDown(event, input.current)}
            >
                <View
                    testID="input-frame"
                    style={{
                        width: '100%',
                        height: ASSISTANT_INPUT_MIN_HEIGHT,
                        paddingVertical: ASSISTANT_INPUT_VERTICAL_PADDING / 2,
                        paddingHorizontal: 8,
                        fontSize: 14,
                        lineHeight: 24,
                        overflow: 'hidden',
                    }}
                >
                    <ReactQuill
                        ref={reactQuill}
                        modules={{ toolbar: false }}
                        formats={[]}
                        placeholder="Starte einen neuen Chat"
                    />
                </View>
            </View>
            <View
                testID="assistant-composer-toolbar"
                style={{ flexDirection: 'row', justifyContent: 'space-between', height: 36, marginTop: 4 }}
            >
                <View style={{ flexDirection: 'row', gap: 4 }}>
                    <button data-testid="attach" onClick={press('attach')}>
                        +
                    </button>
                    <button data-testid="templates" onClick={press('templates')}>
                        Vorlagen
                    </button>
                </View>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                    <button data-testid="mic" onClick={press('mic')}>
                        mic
                    </button>
                    <button data-testid="call" onClick={press('call')}>
                        call
                    </button>
                    <button data-testid="send" onClick={press('send')}>
                        send
                    </button>
                </View>
            </View>
            {ready ? <span data-testid="ready" /> : null}
        </View>
    )
}

createRoot(document.getElementById('root')).render(<Composer />)
