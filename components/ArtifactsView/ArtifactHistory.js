import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { watchArtifactHistory } from '../../utils/backends/Artifacts/artifactsFirestore'
import { ARTIFACT_HISTORY_TYPES } from '../../functions/Artifacts/artifactHistory'
import { formatArtifactDate } from './artifactPresentation'
import { withMcpActorLabel } from '../../utils/mcpActorLabel'

const ICONS = {
    [ARTIFACT_HISTORY_TYPES.CREATED]: 'plus-circle',
    [ARTIFACT_HISTORY_TYPES.VERSION]: 'upload',
    [ARTIFACT_HISTORY_TYPES.RESTORED]: 'rotate-ccw',
    [ARTIFACT_HISTORY_TYPES.RENAMED]: 'edit-2',
    [ARTIFACT_HISTORY_TYPES.DESCRIPTION]: 'align-left',
    [ARTIFACT_HISTORY_TYPES.MADE_PRIVATE]: 'lock',
    [ARTIFACT_HISTORY_TYPES.SHARED]: 'users',
    [ARTIFACT_HISTORY_TYPES.LINK_RESET]: 'refresh-cw',
    [ARTIFACT_HISTORY_TYPES.LINK_ROTATED]: 'refresh-cw',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_ON]: 'globe',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_OFF]: 'eye-off',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_CHANGED]: 'refresh-cw',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_WITHDRAWN]: 'eye-off',
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_ON]: 'bar-chart-2',
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_OFF]: 'bar-chart-2',
}

const TEXT_KEYS = {
    [ARTIFACT_HISTORY_TYPES.CREATED]: 'Artifact history created',
    [ARTIFACT_HISTORY_TYPES.VERSION]: 'Artifact history version',
    [ARTIFACT_HISTORY_TYPES.RESTORED]: 'Artifact history restored',
    [ARTIFACT_HISTORY_TYPES.RENAMED]: 'Artifact history renamed',
    [ARTIFACT_HISTORY_TYPES.DESCRIPTION]: 'Artifact history description',
    [ARTIFACT_HISTORY_TYPES.MADE_PRIVATE]: 'Artifact history made private',
    [ARTIFACT_HISTORY_TYPES.SHARED]: 'Artifact history shared',
    [ARTIFACT_HISTORY_TYPES.LINK_RESET]: 'Artifact history link reset',
    [ARTIFACT_HISTORY_TYPES.LINK_ROTATED]: 'Artifact history link rotated',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_ON]: 'Artifact history public link on',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_OFF]: 'Artifact history public link off',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_CHANGED]: 'Artifact history public link changed',
    [ARTIFACT_HISTORY_TYPES.PUBLIC_LINK_WITHDRAWN]: 'Artifact history public link withdrawn',
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_ON]: 'Artifact history data access on',
    [ARTIFACT_HISTORY_TYPES.DATA_ACCESS_OFF]: 'Artifact history data access off',
}

function getAssistantName(assistantId) {
    if (!assistantId) return ''
    try {
        // Required on use: the assistants helper reaches a large part of the store.
        return require('../AdminPanel/Assistants/assistantsHelper').getAssistant(assistantId)?.displayName || ''
    } catch (error) {
        return ''
    }
}

// Who did it, as a reader of the timeline would say it: "Anna for Karsten" when an assistant
// acted for someone, "Karsten (via Claude)" when their MCP client did, otherwise the person.
export function describeArtifactHistoryActor(event, users = []) {
    const user = users.find(candidate => candidate?.uid === event.actorId)
    const userName = withMcpActorLabel(user?.displayName || (event.actorId ? translate('Someone') : ''), event)
    const assistantName = getAssistantName(event.assistantId)
    if (assistantName && userName)
        return translate('Artifact history actor for', { assistant: assistantName, user: userName })
    return assistantName || userName
}

export function describeArtifactHistoryEvent(event, users = []) {
    const key = TEXT_KEYS[event.type]
    if (!key) return ''
    return translate(key, {
        actor: describeArtifactHistoryActor(event, users),
        number: event.versionNumber,
        from: event.from,
        to: event.to,
    })
}

const EMPTY_USERS = []

// The artifact's Updates: what happened to it, newest first, from the history Cloud Functions
// keep (functions/Artifacts/artifactHistory.js).
export default function ArtifactHistory({ projectId, artifactId }) {
    const users = useSelector(state => state.projectUsers?.[projectId] || EMPTY_USERS)
    const [events, setEvents] = useState(undefined)

    useEffect(() => {
        setEvents(undefined)
        return watchArtifactHistory(projectId, artifactId, setEvents, () => setEvents([]))
    }, [projectId, artifactId])

    if (events === undefined) return <Text style={localStyles.meta}>{translate('Loading artifact')}</Text>
    if (events.length === 0)
        return (
            <Text testID="artifact-history-empty" style={localStyles.empty}>
                {translate('Artifact history empty')}
            </Text>
        )

    return (
        <View testID="artifact-history" style={localStyles.container}>
            {events.map(event => {
                const text = describeArtifactHistoryEvent(event, users)
                if (!text) return null
                return (
                    <View key={event.id} testID={`artifact-history-${event.id}`} style={localStyles.row}>
                        <Icon name={ICONS[event.type] || 'clock'} size={16} color={colors.Text03} />
                        <View style={localStyles.texts}>
                            <Text style={localStyles.text}>{text}</Text>
                            <Text style={localStyles.meta}>
                                {formatArtifactDate(event.date)}
                                {event.changeSummary ? ` · ${event.changeSummary}` : ''}
                            </Text>
                        </View>
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 12,
        maxWidth: 720,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    texts: {
        flex: 1,
        marginLeft: 10,
    },
    text: {
        ...styles.body2,
        color: colors.Text01,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    empty: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 16,
    },
})
