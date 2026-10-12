import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import AnnaTimestamp from './AnnaTimestamp'
import { isBrowserOffline } from '../../utils/connectionState'
import { loadAnnaActivityContent } from './annaActivityContent'
import { annaActivityHistory } from './annaActivityHistory'
import { getAnnaActivityLabel } from './annaActivityText'

export default function AnnaActivityNotice({ notice, onChange }) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const connectionState = useSelector(state => state.connectionState)
    const [resolved, setResolved] = useState(null)
    const savedContent = useMemo(
        () => notice.content || annaActivityHistory.readNotice(userId, notice.id)?.content,
        [userId, notice.id, notice.content]
    )
    const content = resolved?.userId === userId && resolved.id === notice.id ? resolved.content : savedContent

    useLayoutEffect(() => {
        // Enrichment can add several wrapped lines. Use the conversation's existing follow/anchor
        // policy so readers at the bottom see them without pulling readers out of older messages.
        onChange?.()
    }, [content, onChange])

    useEffect(() => {
        if (
            !userId ||
            notice.userId !== userId ||
            content?.version === 1 ||
            connectionState === 'offline' ||
            isBrowserOffline()
        )
            return
        let active = true
        loadAnnaActivityContent(notice, userId).then(details => {
            if (!active || !details) return
            const enriched = annaActivityHistory.enrich(userId, notice, details)
            setResolved({ userId, id: notice.id, content: enriched.content })
        })
        return () => {
            active = false
        }
    }, [userId, notice.id, connectionState, content])

    const metadata = [content?.actorName, notice.projectName].filter(Boolean).join(' · ')
    return (
        <p className="anna-context-notice anna-activity-notice">
            <a href={notice.path}>
                <span className="anna-activity-dot" aria-hidden="true" />
                <span className="anna-activity-content">
                    <span className="anna-activity-title">{getAnnaActivityLabel({ ...notice, content })}</span>
                    {content?.preview ? <span className="anna-activity-preview">{content.preview}</span> : null}
                    {metadata ? <span className="anna-activity-meta">{metadata}</span> : null}
                </span>
                <Icon name="arrow-right" size={14} color="currentColor" />
            </a>
            <AnnaTimestamp timestamp={notice.created} />
        </p>
    )
}
