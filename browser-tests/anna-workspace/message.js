import React from 'react'
import BrowserApprovalCard from '../../components/ChatsView/ChatDV/EditorView/BrowserApprovalCard'

export default ({ commentText, messageId, chat }) => (
    <>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{commentText}</p>
        {messageId === 'm2' && new URLSearchParams(window.location.search).has('login') && (
            <BrowserApprovalCard projectId="p1" objectId={chat.id} commentId="m2" />
        )}
    </>
)
