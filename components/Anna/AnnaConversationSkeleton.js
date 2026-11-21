import React from 'react'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'

// AT-3119: the shape of a chat while it has no local copy yet. Rows alternate between an answer
// (author line and text lines) and a message of the user's (a bubble on the right).
const ROWS = [
    { own: false, lines: [92, 78, 54] },
    { own: true, lines: [64] },
    { own: false, lines: [86, 70] },
]

export const AnnaMessagesSkeleton = ({ label, rows = ROWS }) => (
    <div className="anna-skeleton-thread" role="status" aria-live="polite" data-testid="anna-messages-skeleton">
        <span className="anna-call-sr-only">{label}</span>
        {rows.map((row, index) => (
            <div
                key={index}
                className={`anna-skeleton-message${row.own ? ' anna-skeleton-message-user' : ''}`}
                aria-hidden="true"
            >
                {!row.own && (
                    <div className="anna-skeleton-author">
                        <span className="anna-skeleton-block anna-skeleton-avatar" />
                        <span className="anna-skeleton-block anna-skeleton-name" />
                    </div>
                )}
                {row.lines.map((width, line) => (
                    <span
                        key={line}
                        className="anna-skeleton-block anna-skeleton-line"
                        style={{ width: `${width}%` }}
                    />
                ))}
            </div>
        ))}
    </div>
)

// AT-3119: first entry into assistant mode on a device without a saved chat waits for the server
// (getAnnaConversation, about 3s, up to 8s on a cold start). Until then the chat keeps its layout:
// the timeline as a skeleton and the composer in its place, inert, saying what is happening. Nothing
// here is focusable or typed into, so a draft can never be lost when the real composer replaces it,
// and the shell's focus handoff to the first real input keeps working.
const AnnaConversationSkeleton = () => {
    const label = translate('Loading conversation…')
    return (
        <>
            <div className="anna-messages anna-skeleton-messages" data-testid="anna-conversation-skeleton">
                <div className="anna-message-timeline">
                    <div className="anna-date-divider" aria-hidden="true">
                        <span className="anna-skeleton-block anna-skeleton-date" />
                    </div>
                    <AnnaMessagesSkeleton label={label} />
                </div>
            </div>
            <div className="anna-composer anna-composer-skeleton" aria-hidden="true">
                <div className="anna-composer-slot">
                    <div className="anna-composer-field">
                        <div className="anna-composer-draft">
                            <div className="anna-composer-skeleton-text">{label}</div>
                            <div className="anna-composer-toolbar">
                                <div className="anna-composer-tools">
                                    <span className="anna-composer-skeleton-icon">
                                        <Icon name="plus" size={20} color="currentColor" />
                                    </span>
                                </div>
                                <div className="anna-composer-actions">
                                    <span className="anna-composer-skeleton-icon">
                                        <Icon name="phone-call" size={20} color="currentColor" />
                                    </span>
                                    <span className="anna-send anna-composer-skeleton-send">
                                        <Icon name="arrow-up" size={20} color="currentColor" />
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default AnnaConversationSkeleton
