import React from 'react'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/messageTimestamps'
import { translate } from '../../i18n/TranslationService'
import MessageSendStatus from '../ChatsView/ChatDV/EditorView/MessageSendStatus'
import AnnaTimestamp from './AnnaTimestamp'

export default function AnnaMessageAuthor({ message, creator, own, onSendNow, onRemove }) {
    return (
        <div className="anna-message-author">
            {!own && creator?.isAssistant && (
                <span className="anna-message-avatar" aria-hidden="true">
                    <AssistantAvatar
                        photoURL={creator.photoURL?.uri || creator.photoURL}
                        assistantId={message.creatorId}
                        size={20}
                    />
                </span>
            )}
            <span className="anna-message-author-name">{own ? translate('You') : creator?.displayName}</span>
            <AnnaTimestamp timestamp={getTimestampInMilliseconds(message.created || message.lastChangeDate)} />
            <MessageSendStatus
                label={message.submission && translate('assistantLineSending')}
                pendingSend={
                    message.submission
                        ? message.submission.status === 'sending'
                            ? { status: 'pending' }
                            : message.submission.status === 'queued'
                              ? { status: 'queued' }
                              : null
                        : message.pendingSend
                }
                onSendNow={onSendNow}
                onRemove={onRemove}
            />
        </div>
    )
}
