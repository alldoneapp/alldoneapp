import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import AssistantOptions from './AssistantOptions/AssistantOptions'
import { calculateAmountOfOptionButtons, getAssistantLineData } from './AssistantOptions/helper'
import LastCommentArea from './LastCommentArea'
import AssistantAvatar from '../../AdminPanel/Assistants/AssistantAvatar'
import Icon from '../../Icon'

export default function AssistantLine({
    showLastComment = true,
    removeBottomSpace = false,
    useAssistantProjectContext = true,
    useGlobalLatestComment = false,
    projectOverride = null,
    assistantIdOverride = null,
    startCollapsed = false,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectFromStore = useSelector(state => state.loggedUserProjects?.[selectedProjectIndex])
    const selectedProject = projectOverride || selectedProjectFromStore
    const [amountOfButtonOptions, setAmountOfButtonOptions] = useState(0)
    const [isCollapsed, setIsCollapsed] = useState(startCollapsed)
    const assistantId = assistantIdOverride || defaultAssistant?.uid

    const { assistant: selectedLineAssistant } = getAssistantLineData(
        selectedProject,
        assistantId,
        loggedUser?.defaultProjectId
    )
    const selectedAssistant = selectedLineAssistant || defaultAssistant

    const onLayout = data => {
        const amountOfButtonOptions = calculateAmountOfOptionButtons(
            data.nativeEvent.layout.width,
            isMiddleScreen,
            isMobile
        )
        setAmountOfButtonOptions(amountOfButtonOptions)
    }

    const hasRequiredData = defaultAssistant && defaultAssistant.uid && loggedUser && loggedUser.defaultProjectId

    useEffect(() => {
        setIsCollapsed(startCollapsed)
    }, [startCollapsed, selectedProject?.id, assistantId])

    if (!hasRequiredData) {
        return (
            <View style={localStyles.container} onLayout={onLayout}>
                <View style={localStyles.loadingContainer}>
                    <Text style={localStyles.loadingText}>Loading assistant...</Text>
                </View>
            </View>
        )
    }

    return (
        <View
            style={[
                localStyles.container,
                isCollapsed && localStyles.containerCollapsed,
                removeBottomSpace && localStyles.containerWithoutBottomSpace,
            ]}
            onLayout={onLayout}
        >
            {isCollapsed ? (
                <CollapsedAssistantRow
                    assistant={selectedAssistant}
                    showLastComment={showLastComment}
                    useAssistantProjectContext={useAssistantProjectContext}
                    useGlobalLatestComment={useGlobalLatestComment}
                    onPress={() => setIsCollapsed(false)}
                    projectOverride={selectedProject}
                    assistantIdOverride={assistantId}
                />
            ) : (
                <View>
                    <AssistantOptions
                        amountOfButtonOptions={amountOfButtonOptions}
                        onCollapse={() => setIsCollapsed(true)}
                        projectOverride={selectedProject}
                        assistantIdOverride={assistantId}
                    />
                    {showLastComment && (
                        <LastCommentArea
                            withTopMargin={true}
                            useAssistantProjectContext={useAssistantProjectContext}
                            useGlobalLatestComment={useGlobalLatestComment}
                            projectOverride={selectedProject}
                            assistantIdOverride={assistantId}
                        />
                    )}
                </View>
            )}
        </View>
    )
}

function CollapsedAssistantRow({
    assistant,
    showLastComment,
    useAssistantProjectContext,
    useGlobalLatestComment,
    onPress,
    projectOverride,
    assistantIdOverride,
}) {
    const isMobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity
            style={[localStyles.collapsedRow, isMobile && localStyles.collapsedRowMobile]}
            onPress={onPress}
        >
            <View style={[localStyles.collapsedLeft, isMobile && localStyles.collapsedLeftMobile]}>
                <AssistantAvatar
                    photoURL={assistant?.photoURL50 || assistant?.photoURL300 || assistant?.photoURL}
                    assistantId={assistant?.uid}
                    size={24}
                    imageStyle={localStyles.collapsedAvatar}
                />
                <Text
                    numberOfLines={1}
                    style={[localStyles.collapsedAssistantName, isMobile && localStyles.collapsedAssistantNameMobile]}
                >
                    {assistant?.displayName || 'Assistant'}
                </Text>
            </View>
            {showLastComment && (
                <View style={[localStyles.collapsedTagWrapper, isMobile && localStyles.collapsedTagWrapperMobile]}>
                    <LastCommentArea
                        withTopMargin={false}
                        useAssistantProjectContext={useAssistantProjectContext}
                        useGlobalLatestComment={useGlobalLatestComment}
                        compact={true}
                        projectOverride={projectOverride}
                        assistantIdOverride={assistantIdOverride}
                    />
                </View>
            )}
            <Icon
                name={'chevron-down'}
                size={16}
                color={colors.Text03}
                style={[localStyles.chevron, isMobile && localStyles.chevronMobile]}
            />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey200,
        marginTop: 8,
        borderRadius: 4,
        minHeight: 128,
        marginBottom: 24,
        paddingLeft: 10,
        paddingRight: 16,
        paddingTop: 14,
        paddingBottom: 12,
    },
    containerWithoutBottomSpace: {
        marginBottom: 0,
    },
    containerCollapsed: {
        minHeight: 0,
        paddingTop: 8,
        paddingBottom: 8,
    },
    collapsedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        minHeight: 32,
    },
    collapsedRowMobile: {
        minHeight: 36,
        paddingRight: 2,
    },
    collapsedLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
        marginRight: 10,
        flexShrink: 1,
    },
    collapsedLeftMobile: {
        marginRight: 6,
    },
    collapsedAvatar: {
        borderRadius: 6,
    },
    collapsedAssistantName: {
        marginLeft: 8,
        fontSize: 14,
        color: colors.Text02,
        fontWeight: '600',
        maxWidth: 180,
        flexShrink: 1,
    },
    collapsedAssistantNameMobile: {
        marginLeft: 6,
        maxWidth: 92,
    },
    collapsedTagWrapper: {
        marginLeft: 'auto',
        marginRight: 8,
        alignItems: 'flex-end',
        maxWidth: 320,
        minWidth: 0,
    },
    collapsedTagWrapperMobile: {
        marginRight: 4,
        maxWidth: '56%',
    },
    chevron: {
        marginLeft: 0,
    },
    chevronMobile: {
        marginLeft: 2,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 14,
        color: colors.Grey600,
    },
})
