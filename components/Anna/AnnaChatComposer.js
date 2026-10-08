import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import ReactQuill from 'react-quill-new'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import { CHAT_INPUT_LIMIT_IN_CHARACTERS } from '../../utils/assistantHelper'

const Delta = ReactQuill.Quill.import('delta')

// Reuse the chat editor's picker, embeds and serialization. Anna keeps its own
// dictation controls and send lifecycle, including concurrent messages/retries.
const AnnaChatComposer = forwardRef(function AnnaChatComposer(
    { projectId, placeholder, label, disabled, onChangeText, onFocus, onSubmit },
    ref
) {
    const input = useRef(null)
    const editor = useRef(null)
    const selection = useRef({ index: 0, length: 0 })
    const mentionsActive = useRef(false)
    const frame = useRef(null)

    useEffect(() => {
        editor.current?.root.setAttribute('aria-label', label)
    }, [label])

    useImperativeHandle(ref, () => ({
        focus: () => input.current?.focus(),
        clear: () => {
            input.current?.clear()
            selection.current = { index: 0, length: 0 }
            mentionsActive.current = false
        },
        setContent: text => input.current?.clearAndSetContent(text),
        getPane: () => frame.current?.closest('.anna-conversation'),
        insertDictation: (text, visible) => {
            const quill = editor.current
            if (!quill || disabled || !text) return
            const shouldFocus = visible && frame.current?.closest('form')?.contains(document.activeElement)
            const { index, length } = quill.getSelection() || selection.current
            const before = index > 0 ? quill.getText(index - 1, 1) : ''
            const after = quill.getText(index + length, 1)
            const insertion = `${before && !/\s/.test(before) ? ' ' : ''}${text}${
                after && !/^[\s.,!?;:)\]}]/.test(after) ? ' ' : ''
            }`
            quill.updateContents(new Delta().retain(index).delete(length).insert(insertion), 'user')
            const caret = Math.min(index + insertion.length, quill.getLength() - 1)
            selection.current = { index: caret, length: 0 }
            // setSelection focuses Quill: a delayed transcript must leave the
            // workspace in control when the user has moved away from the chat.
            if (shouldFocus) quill.setSelection(caret, 0, 'silent')
        },
    }))

    return (
        <div
            ref={frame}
            className="anna-rich-composer"
            onFocusCapture={onFocus}
            onKeyDownCapture={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (mentionsActive.current) return
                event.stopPropagation()
                if (event.shiftKey) {
                    const quill = editor.current
                    if (disabled || !quill) return
                    const { index, length } = quill.getSelection() || selection.current
                    quill.updateContents(new Delta().retain(index).delete(length).insert('\n'), 'user')
                    quill.setSelection(index + 1, 0, 'silent')
                    return
                }
                if (!disabled) onSubmit()
            }}
        >
            <CustomTextInput3
                ref={input}
                projectId={projectId}
                placeholder={placeholder}
                styleTheme={TASK_THEME}
                fixedHeight={56}
                maxHeight={160}
                characterLimit={CHAT_INPUT_LIMIT_IN_CHARACTERS}
                disabledEdition={disabled}
                keepBreakLines
                hideDictation
                insertAssistantAsMention
                getMentionViewport={() => {
                    const bounds = frame.current?.closest('.anna-conversation')?.getBoundingClientRect()
                    return bounds && { ...bounds.toJSON(), active: true }
                }}
                onChangeText={onChangeText}
                setMentionsModalActive={active => {
                    mentionsActive.current = active
                }}
                onCustomSelectionChange={range => {
                    if (range) selection.current = range
                }}
                setEditor={quill => {
                    editor.current = quill
                    quill.root.setAttribute('role', 'textbox')
                    quill.root.setAttribute('aria-label', label)
                    quill.root.setAttribute('aria-multiline', 'true')
                }}
            />
        </div>
    )
})

export default AnnaChatComposer
