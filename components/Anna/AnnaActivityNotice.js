import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import AnnaTimestamp from './AnnaTimestamp'
import { isBrowserOffline } from '../../utils/connectionState'
import { translate } from '../../i18n/TranslationService'
import { loadAnnaActivityContent } from './annaActivityContent'
import { annaActivityHistory } from './annaActivityHistory'
import { getAnnaActivityAction, getAnnaActivityLabel } from './annaActivityText'
import { publishAnnaActivityContext } from './annaActivityContext'
import { getAnnaActivityObject, getAnnaActivityTarget } from './annaActivityGroups'
import { splitActivityPreview } from './annaActivityLinks'

const isOffline = connectionState => connectionState === 'offline' || isBrowserOffline()

// Saved content first, then what this mount enriched. Every notice keeps its own history entry
// and its own assistant-context document; grouping changes only how they are drawn.
function useAnnaActivityContents(notices, onChange) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const connectionState = useSelector(state => state.connectionState)
    const [resolved, setResolved] = useState({})
    const ids = notices.map(notice => notice.id).join('\n')
    const saved = useMemo(
        () => notices.map(notice => notice.content || annaActivityHistory.readNotice(userId, notice.id)?.content),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [userId, ids, ...notices.map(notice => notice.content)]
    )
    const contents = notices.map((notice, index) => resolved[`${userId}/${notice.id}`] || saved[index])
    const contentsKey = contents.map(content => (content?.version === 1 ? JSON.stringify(content) : '')).join('\n')

    useEffect(() => {
        if (!userId || isOffline(connectionState)) return
        notices.forEach((notice, index) => {
            if (notice.userId !== userId) return
            const content = contents[index]
            publishAnnaActivityContext(userId, {
                ...notice,
                ...(content?.version === 1
                    ? { content: { ...content, label: getAnnaActivityLabel({ ...notice, content }) } }
                    : {}),
            }).catch(() => {}) // Keep the timeline usable; a reconnect/remount retries the reference sync.
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, ids, contentsKey, connectionState])

    useLayoutEffect(() => {
        // Enrichment can add several wrapped lines. Use the conversation's existing follow/anchor
        // policy so readers at the bottom see them without pulling readers out of older messages.
        onChange?.()
    }, [contentsKey, onChange])

    useEffect(() => {
        if (!userId || isOffline(connectionState)) return
        let active = true
        notices.forEach((notice, index) => {
            if (notice.userId !== userId || contents[index]?.version === 1) return
            loadAnnaActivityContent(notice, userId).then(details => {
                if (!active || !details) return
                const enriched = annaActivityHistory.enrich(userId, notice, details)
                setResolved(previous => ({ ...previous, [`${userId}/${notice.id}`]: enriched.content }))
            })
        })
        return () => {
            active = false
        }
        // Not keyed on contents: one row resolving must not discard the loads of the others.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, ids, connectionState])

    return contents
}

// The project's current name (it may have been renamed since the notice was saved), then the
// saved one; a project this session does not know is still named, never left blank.
function useAnnaActivityProjectName(notice) {
    const projectId = getAnnaActivityObject(notice)?.projectId || notice.sourceProjectId
    const liveName = useSelector(state => (projectId ? state.loggedUserProjectsMap?.[projectId]?.name : '') || '')
    return liveName || notice.projectName || translate('Anna activity unknown project')
}

function ActivityPreview({ text }) {
    return (
        <span className="anna-activity-preview">
            {splitActivityPreview(text).map((part, index) =>
                part.type === 'link' ? (
                    <span className="anna-activity-link" key={index} title={part.url}>
                        <Icon name="link" size={10} color="currentColor" />
                        <span className="anna-activity-link-label">{part.label}</span>
                    </span>
                ) : (
                    <React.Fragment key={index}>{part.text}</React.Fragment>
                )
            )}
        </span>
    )
}

// The actions of one row. Repeated state changes ("Notiz aktualisiert" twice, or the old German +
// English pair of one completion) read once; each chat message is distinct content, so those count.
export function summarizeAnnaActivityActions(entries) {
    const actions = []
    const feedActions = new Set()
    let messages = 0
    entries.forEach(entry => {
        if (entry.kind === 'chat') {
            messages++
            return
        }
        const action = getAnnaActivityAction(entry)
        if (feedActions.has(action)) return
        feedActions.add(action)
        actions.push(action)
    })
    if (messages === 1) actions.push(translate('New chat message'))
    if (messages > 1) actions.push(translate('Anna activity new messages', { count: messages }))
    return actions
}

export function AnnaActivityGroup({ notices, onChange }) {
    const contents = useAnnaActivityContents(notices, onChange)
    const entries = notices.map((notice, index) => ({ ...notice, content: contents[index] }))
    const last = entries[entries.length - 1]
    const objectName = [...entries].reverse().find(entry => entry.content?.objectName)?.content.objectName || ''
    const actions = summarizeAnnaActivityActions(entries)
    const preview = [...entries].reverse().find(entry => entry.content?.preview)?.content.preview || ''
    const actors = [...new Set(entries.map(entry => entry.content?.actorName).filter(Boolean))]
    const projectName = useAnnaActivityProjectName(last)
    // Always the first line, project before people (AT-2906): rows from several projects are
    // told apart before reading them.
    const metadata = [projectName, actors.join(', ')].filter(Boolean).join(' · ')
    const target = getAnnaActivityTarget(entries)

    return (
        <p
            className="anna-context-notice anna-activity-notice"
            data-anna-activity-count={entries.length > 1 ? entries.length : undefined}
        >
            <a href={target} data-anna-activity-link="">
                <span className="anna-activity-content">
                    <span className="anna-activity-meta">{metadata}</span>
                    {objectName ? (
                        <>
                            <span className="anna-activity-title" title={objectName}>
                                {objectName}
                            </span>
                            <span className="anna-activity-actions">
                                {actions.map((action, index) => (
                                    // One line with an ellipsis at the row's width (AT-2918);
                                    // the title keeps the full text reachable.
                                    <span className="anna-activity-action" key={index} title={action}>
                                        {action}
                                    </span>
                                ))}
                            </span>
                        </>
                    ) : (
                        // Not enriched (yet, or unreadable): the action is the most useful title.
                        <span className="anna-activity-title" title={actions.join(' · ')}>
                            {actions.join(' · ')}
                        </span>
                    )}
                    {preview ? <ActivityPreview text={preview} /> : null}
                </span>
                <Icon name="arrow-right" size={14} color="currentColor" />
            </a>
            <AnnaTimestamp timestamp={last.created} />
        </p>
    )
}

export default function AnnaActivityNotice({ notice, onChange }) {
    return <AnnaActivityGroup notices={[notice]} onChange={onChange} />
}
