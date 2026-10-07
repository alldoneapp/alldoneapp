import React from 'react'
import BrowserApprovalCard from '../../components/ChatsView/ChatDV/EditorView/BrowserApprovalCard'

export default ({ commentText, messageId }) => (
    <>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{commentText}</p>
        {messageId === 'm2' && new URLSearchParams(window.location.search).has('login') && (
            <BrowserApprovalCard projectId="p1" objectId="AnnaChat20261007demo" commentId="m2" />
        )}
    </>
)
