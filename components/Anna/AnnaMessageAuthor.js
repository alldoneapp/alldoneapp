import React from 'react'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/messageTimestamps'
import { translate } from '../../i18n/TranslationService'
import MessageSendStatus from '../ChatsView/ChatDV/EditorView/MessageSendStatus'

export default function AnnaMessageAuthor({ message, creator, own }) {
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
            <time>
                {new Date(getTimestampInMilliseconds(message.created || message.lastChangeDate)).toLocaleTimeString(
                    [],
                    { hour: '2-digit', minute: '2-digit' }
                )}
            </time>
            <MessageSendStatus
                label={message.submission && translate('assistantLineSending')}
                pendingSend={
                    message.submission
                        ? message.submission.status === 'sending'
                            ? { status: 'pending' }
                            : null
                        : message.pendingSend
                }
            />
        </div>
    )
}
