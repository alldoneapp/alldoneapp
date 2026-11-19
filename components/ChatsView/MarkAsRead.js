import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'
import ProjectLineActionButton from './ProjectLineActionButton'

const MarkAsRead = ({ projectId, projectIds, userId, containerStyle }) => {
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const idsToMark = projectIds || (projectId ? [projectId] : [])
    const disabled = loading || idsToMark.length === 0
    const label = projectIds ? 'mark all as read' : 'mark as read'

    const markRead = async () => {
        if (disabled) return

        setLoading(true)
        setError(false)
        try {
            const failures = []
            await Promise.all(
                idsToMark.map(async id => {
                    try {
                        await markMessagesAsRead(id, userId, chatsActiveTab)
                    } catch (projectError) {
                        failures.push({ id, error: projectError })
                    }
                })
            )
            if (failures.length > 0) throw failures[0].error
        } catch (markReadError) {
            console.error('Failed to mark chat messages as read', markReadError)
            setError(true)
        } finally {
            setLoading(false)
        }
    }

    return (
        <ProjectLineActionButton
            icon="double-check"
            label={translate(error ? 'try again' : label)}
            // Kept as the full sentence: the icon-only mobile variant has no room for "try again",
            // so the failure has to be readable from the accessible name itself.
            accessibilityLabel={translate(error ? 'Could not mark as read. Try again' : label)}
            loading={loading}
            error={error}
            disabled={disabled}
            onPress={markRead}
            containerStyle={containerStyle}
        />
    )
}

export default MarkAsRead
