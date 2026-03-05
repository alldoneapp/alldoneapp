import React, { useMemo } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import DelegationTargetsAccessWrapper from './DelegationTargetsAccessWrapper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

const buildDelegationTargetKey = (projectId, assistantId) => `${projectId}:${assistantId}`
const normalizeId = value => String(value || '').trim()

const getAccessibleProjectIds = (loggedUser, currentProjectId) => {
    const ids = []
    const appendIds = rawIds => {
        if (!Array.isArray(rawIds)) return
        rawIds.forEach(id => {
            const normalized = normalizeId(id)
            if (normalized && !ids.includes(normalized)) ids.push(normalized)
        })
    }

    appendIds(loggedUser?.projectIds)
    appendIds(loggedUser?.guideProjectIds)
    appendIds(loggedUser?.templateProjectIds)
    appendIds(loggedUser?.archivedProjectIds)

    const normalizedCurrentProjectId = normalizeId(currentProjectId)
    if (normalizedCurrentProjectId && !ids.includes(normalizedCurrentProjectId)) ids.push(normalizedCurrentProjectId)

    return ids
}

const getDelegationScopeProjectIds = (loggedUser, assistant, currentProjectId) => {
    const normalizedCurrentProjectId = normalizeId(currentProjectId)
    const normalizedDefaultProjectId = normalizeId(loggedUser?.defaultProjectId)
    const isDefaultProjectAssistantContext =
        normalizedDefaultProjectId === normalizedCurrentProjectId && assistant?.isDefault

    return isDefaultProjectAssistantContext
        ? getAccessibleProjectIds(loggedUser, normalizedCurrentProjectId)
        : [normalizedCurrentProjectId].filter(Boolean)
}

const getDelegationDescription = target => {
    return (
        (typeof target?.delegationToolDescriptionManual === 'string' &&
            target.delegationToolDescriptionManual.trim()) ||
        (typeof target?.delegationToolDescriptionGenerated === 'string' &&
            target.delegationToolDescriptionGenerated.trim()) ||
        (typeof target?.description === 'string' && target.description.trim()) ||
        ''
    )
}

export default function DelegationTargetsAccessProperty({ disabled, projectId, assistant }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const projectAssistantsByProject = useSelector(state => state.projectAssistants || {})

    const availableTargets = useMemo(() => {
        const scopedProjectIds = getDelegationScopeProjectIds(loggedUser, assistant, projectId)
        const targets = []
        const seenTargetKeys = new Set()

        scopedProjectIds.forEach(targetProjectId => {
            const assistantsInProject = Array.isArray(projectAssistantsByProject?.[targetProjectId])
                ? projectAssistantsByProject[targetProjectId]
                : []
            const projectName = ProjectHelper.getProjectById(targetProjectId)?.name || targetProjectId

            assistantsInProject.forEach(target => {
                const targetAssistantId = normalizeId(target?.uid)
                if (!targetAssistantId || targetAssistantId === assistant.uid) return

                const targetKey = buildDelegationTargetKey(targetProjectId, targetAssistantId)
                if (seenTargetKeys.has(targetKey)) return
                seenTargetKeys.add(targetKey)

                targets.push({
                    uid: targetAssistantId,
                    displayName: target.displayName || 'Assistant',
                    description: getDelegationDescription(target),
                    targetKey,
                    projectId: targetProjectId,
                    projectName,
                })
            })
        })

        return targets.sort((a, b) => {
            const projectCompare = a.projectName.localeCompare(b.projectName)
            if (projectCompare !== 0) return projectCompare
            return a.displayName.localeCompare(b.displayName)
        })
    }, [assistant, loggedUser, projectAssistantsByProject, projectId])

    const hasSelection = Array.isArray(assistant.allowedDelegationTargetKeys)
    const rawSelectedKeys = hasSelection ? assistant.allowedDelegationTargetKeys : []
    const selectedKeys = new Set(rawSelectedKeys.map(key => String(key || '').trim()).filter(Boolean))

    const selectedTargets = hasSelection
        ? availableTargets.filter(target => selectedKeys.has(target.targetKey) || selectedKeys.has(target.uid))
        : availableTargets

    const summaryText = !availableTargets.length
        ? translate('No assistants available for delegation')
        : !hasSelection
        ? translate('All assistants enabled for delegation')
        : !selectedTargets.length
        ? translate('No assistants enabled for delegation')
        : selectedTargets.map(target => `${target.displayName} (${target.projectName})`).join(', ')

    const selectionCount = hasSelection ? selectedTargets.length : availableTargets.length

    return (
        <View style={localStyles.container}>
            <Icon name="tool" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('Delegation targets')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <DelegationTargetsAccessWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    availableTargets={availableTargets}
                    selectionCount={selectionCount}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    textContainer: {
        flexShrink: 1,
        flexGrow: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    summary: {
        ...styles.caption2,
        color: colors.Text04,
    },
})
