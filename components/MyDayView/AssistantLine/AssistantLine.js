import React from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import AssistantOptions from './AssistantOptions/AssistantOptions'
import { getAssistantLineData } from './AssistantOptions/helper'
import LastCommentArea from './LastCommentArea'
import Icon from '../../Icon'
import AssistantLineSkeleton from './AssistantLineSkeleton'
import { useProjectSectionAccent } from '../../TaskListView/TaskHierarchy'

export default function AssistantLine({
    showLastComment = true,
    removeBottomSpace = false,
    useAssistantProjectContext = true,
    useGlobalLatestComment = false,
    projectOverride = null,
    assistantIdOverride = null,
    // AT-2430: `{ groups, grouped, activeProjectId, activeAssistantId, onSelect }` from
    // `useAssistantLineSwitch`. The line itself stays presentational — WHICH assistant is
    // active is decided by whoever owns the scope (a project board, or the home page), because
    // only they know whether a choice means "talk to someone else here" or "go somewhere else".
    assistantSwitch = null,
    preferAssistantIdOverride = false,
    scopeLastCommentToAssistant = false,
    showEditAssistantButton = false,
    onEditAssistant = null,
    // AT-3034: which project's chat the assistant-mode button opens in the sidebar. By default the
    // line's own project; the "All projects" line passes null ("Automatic", the default assistant).
    assistantModeProjectId,
}) {
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectFromStore = useSelector(state => state.loggedUserProjects?.[selectedProjectIndex])
    const projectAccentColor = useProjectSectionAccent()
    const selectedProject = projectOverride || selectedProjectFromStore
    const assistantId = assistantIdOverride || defaultAssistant?.uid

    const { assistant: selectedLineAssistant, assistantProject: selectedLineAssistantProject } = getAssistantLineData(
        selectedProject,
        assistantId,
        loggedUser?.defaultProjectId,
        preferAssistantIdOverride
    )

    const hasRequiredData =
        defaultAssistant?.uid &&
        loggedUser?.defaultProjectId &&
        selectedLineAssistant?.uid &&
        selectedLineAssistantProject?.id

    if (!hasRequiredData) {
        return (
            <View
                style={[localStyles.container, projectAccentColor && { backgroundColor: projectAccentColor }]}
                testID="assistant-line"
            >
                <AssistantLineSkeleton showLastComment={showLastComment} />
            </View>
        )
    }

    return (
        <View
            style={[
                localStyles.container,
                projectAccentColor && { backgroundColor: projectAccentColor },
                removeBottomSpace && localStyles.containerWithoutBottomSpace,
            ]}
            testID="assistant-line"
        >
            <AssistantOptions
                headerControls={showEditAssistantButton ? <EditAssistantButton onPress={onEditAssistant} /> : null}
                assistantSwitch={assistantSwitch}
                assistantModeProjectId={
                    assistantModeProjectId !== undefined ? assistantModeProjectId : selectedProject?.id || null
                }
                projectOverride={selectedProject}
                assistantIdOverride={assistantId}
                preferAssistantIdOverride={preferAssistantIdOverride}
            />
            {showLastComment && (
                <LastCommentArea
                    withTopMargin={true}
                    useAssistantProjectContext={useAssistantProjectContext}
                    useGlobalLatestComment={useGlobalLatestComment}
                    projectOverride={selectedProject}
                    assistantIdOverride={assistantId}
                    preferAssistantIdOverride={preferAssistantIdOverride}
                    scopeToAssistant={scopeLastCommentToAssistant}
                />
            )}
        </View>
    )
}

function EditAssistantButton({ onPress }) {
    const editAssistant = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        onPress?.()
    }

    return (
        <TouchableOpacity style={localStyles.actionButton} onPress={editAssistant} accessibilityLabel="Edit assistant">
            <Icon name="edit-2" size={16} color={colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey200,
        marginTop: 8,
        borderRadius: 4,
        minHeight: 160,
        marginBottom: 24,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 12,
    },
    containerWithoutBottomSpace: {
        marginBottom: 0,
    },
    actionButton: {
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Grey300,
        marginRight: 8,
    },
})
