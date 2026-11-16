import React, { useContext } from 'react'
import { StyleSheet, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import AssistantOptions from './AssistantOptions/AssistantOptions'
import { getAssistantLineData } from './AssistantOptions/helper'
import LastCommentArea from './LastCommentArea'
import Icon from '../../Icon'
import AssistantLineSkeleton from './AssistantLineSkeleton'
import { useProjectSectionAccent } from '../../TaskListView/TaskHierarchy'
import { AnnaSidebarCloseContext } from '../../Anna/AnnaChatNavigationContext'

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
    // AT-3034 follow-up: while the assistant-mode sidebar is open beside the app, its chat is the
    // place to write, so the line shows only its Last comment card: no header, no composer. The
    // shell provides a close action exactly then (desktop split view; not on mobile, where chat and
    // app take turns, and not in chat-only mode, where the app is hidden).
    const sidebarChatVisible = !!useContext(AnnaSidebarCloseContext)

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
        if (sidebarChatVisible) {
            if (!showLastComment) return null
            return (
                <View testID="assistant-line">
                    <View
                        style={[
                            localStyles.lastCommentCard,
                            projectAccentColor && { backgroundColor: projectAccentColor },
                            removeBottomSpace && localStyles.containerWithoutBottomSpace,
                        ]}
                    >
                        <AssistantLineSkeleton lastCommentOnly />
                    </View>
                </View>
            )
        }
        return (
            <View
                style={[localStyles.container, projectAccentColor && { backgroundColor: projectAccentColor }]}
                testID="assistant-line"
            >
                <AssistantLineSkeleton showLastComment={showLastComment} />
            </View>
        )
    }

    // The element tree keeps the same shape in both modes, so opening or closing the sidebar never
    // remounts the composer (a draft survives) or the Last comment slot (its arrival memory).
    // Hidden, the composer is display:none: nothing can focus it, drop on it or type into it.
    return (
        <View
            style={
                sidebarChatVisible
                    ? localStyles.lastCommentOnlyContainer
                    : [
                          localStyles.container,
                          projectAccentColor && { backgroundColor: projectAccentColor },
                          removeBottomSpace && localStyles.containerWithoutBottomSpace,
                      ]
            }
            testID="assistant-line"
        >
            <View testID="assistant-line-composer" style={sidebarChatVisible ? localStyles.hidden : null}>
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
            </View>
            {/* The assistant board's edit pencil is not a chat control, so it stays reachable. */}
            {sidebarChatVisible && showEditAssistantButton && (
                <View style={localStyles.sidebarModeControls}>
                    <EditAssistantButton onPress={onEditAssistant} />
                </View>
            )}
            {showLastComment && (
                <LastCommentArea
                    withTopMargin={!sidebarChatVisible}
                    style={
                        sidebarChatVisible
                            ? [
                                  localStyles.lastCommentCard,
                                  projectAccentColor && { backgroundColor: projectAccentColor },
                                  removeBottomSpace && localStyles.containerWithoutBottomSpace,
                              ]
                            : null
                    }
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
    // AT-3034 follow-up: the sidebar-open line. The card style moves onto the Last comment area, so
    // an assistant board without a comment from its assistant leaves no empty grey box behind.
    lastCommentOnlyContainer: {
        width: '100%',
    },
    lastCommentCard: {
        width: '100%',
        backgroundColor: colors.Grey200,
        marginTop: 8,
        borderRadius: 4,
        marginBottom: 24,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 12,
    },
    sidebarModeControls: {
        flexDirection: 'row',
        marginTop: 8,
    },
    hidden: {
        display: 'none',
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
