import React, { useState } from 'react'

import { translate } from '../../../i18n/TranslationService'
import MarkAsRead from '../MarkAsRead'
import ProjectLineActionButton from '../ProjectLineActionButton'
import { collectVisibleCommentRefs, useUnreadTriage } from './UnreadTriageContext'
import { UNREAD_TAG_ALL } from './unreadMessageTags'
import { runWithLastUnreadRedirect } from '../lastUnreadRedirect'

const markCommentsRead = refs =>
    require('../../../utils/backends/Chats/markChatCommentsAsRead').markChatCommentsAsRead(refs)

/**
 * "Mark as read" on a project line (or the All Projects line) of the unread list. Without a tag
 * filter it is the usual button, which clears the whole project. With one, it marks only the
 * messages the filter shows: "mark these ads read" must not also clear a colleague's question.
 */
export default function UnreadTriageMarkAsRead({ projectId, projectIds, userId, containerStyle }) {
    const triage = useUnreadTriage()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const filtered = !!triage && triage.tagFilter !== UNREAD_TAG_ALL

    if (!filtered) {
        return (
            <MarkAsRead projectId={projectId} projectIds={projectIds} userId={userId} containerStyle={containerStyle} />
        )
    }

    const refs = collectVisibleCommentRefs(triage.projects, projectIds || (projectId ? [projectId] : undefined))
    const label = projectIds ? 'mark all as read' : 'mark as read'

    const markRead = async () => {
        if (loading || refs.length === 0) return
        setLoading(true)
        setError(false)
        try {
            // If the filtered messages were the view's last unread ones, move on (AT-3104). Messages
            // the filter hides still count, so they keep the user here.
            await runWithLastUnreadRedirect(projectIds || [projectId], () => markCommentsRead(refs))
        } catch (markReadError) {
            console.error('Failed to mark the filtered messages as read', markReadError)
            setError(true)
        } finally {
            setLoading(false)
        }
    }

    return (
        <ProjectLineActionButton
            icon="double-check"
            label={translate(error ? 'try again' : label)}
            accessibilityLabel={translate(error ? 'Could not mark as read. Try again' : label)}
            loading={loading}
            error={error}
            disabled={loading || refs.length === 0}
            onPress={markRead}
            containerStyle={containerStyle}
        />
    )
}
