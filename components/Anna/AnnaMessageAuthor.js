import React from 'react'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import { getTimestampInMilliseconds } from '../ChatsView/Utils/messageTimestamps'
import { translate } from '../../i18n/TranslationService'
import MessageSendStatus from '../ChatsView/ChatDV/EditorView/MessageSendStatus'
import AnnaTimestamp from './AnnaTimestamp'

// AT-2927: the queued note does not fit the author row. It sits on a line of its own under it,
// full width and outside the message's fade, so "Send now" and "Remove" are always reachable.
export default function AnnaMessageAuthor({ message, creator, own, onSendNow, onRemove }) {
    const queued = message.submission?.status === 'queued'
    return (
        <>
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
                {!queued && (
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
                )}
            </div>
            {queued && (
                <div className="anna-message-queue-note">
                    <MessageSendStatus
                        prominent
                        pendingSend={{ status: 'queued' }}
                        onSendNow={onSendNow}
                        onRemove={onRemove}
                    />
                </div>
            )}
        </>
    )
}
