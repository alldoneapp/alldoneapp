import React, { memo } from 'react'
import MessageItemBody from '../ChatsView/ChatDV/EditorView/MessageItemBody'
import useAnnaStreamingText from './useAnnaStreamingText'

// Give an open fenced block its final layout as it grows, rather than rendering
// it as a paragraph until the closing fence arrives. The source stays untouched.
export function streamingMarkdown(text) {
    const fences = text.match(/^\s{0,3}```[^\n]*$/gm)
    return fences?.length % 2 === 1 ? `${text}\n\`\`\`` : text
}

// Paced renders stay inside this message, leaving the composer and history idle.
function AnnaMessageBody({ reducedMotion, ...props }) {
    const streaming =
        !!props.creatorData?.isAssistant &&
        !props.isLoading &&
        props.assistantRun?.kind === 'chat' &&
        props.assistantRun?.status === 'running'
    const text = useAnnaStreamingText(props.commentText, streaming, reducedMotion)
    return (
        <div
            className={props.isLoading ? 'anna-message-progress' : 'anna-message-answer'}
            aria-busy={streaming || undefined}
        >
            <MessageItemBody {...props} commentText={streaming ? streamingMarkdown(text) : text} />
        </div>
    )
}

const sameFields = (a, b) =>
    a === b ||
    (!!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]))

// The timeline constructs presentation objects on each snapshot. Compare those shallowly
// so a token in the last answer does not reparse every older message's markdown.
export default memo(
    AnnaMessageBody,
    (a, b) =>
        Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every(key =>
            ['chat', 'creatorData', 'containerStyle'].includes(key) ? sameFields(a[key], b[key]) : a[key] === b[key]
        )
)
