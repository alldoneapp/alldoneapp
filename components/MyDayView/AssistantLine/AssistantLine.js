import React, { useState } from 'react'
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
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects?.[selectedProjectIndex])
    const [amountOfButtonOptions, setAmountOfButtonOptions] = useState(0)
    const [isCollapsed, setIsCollapsed] = useState(false)

    const { assistant } = getAssistantLineData(selectedProject, defaultAssistant?.uid, loggedUser?.defaultProjectId)
    const lineAssistant = assistant || defaultAssistant
    const assistantName = lineAssistant?.displayName || 'Assistant'

    const onLayout = data => {
        const amountOfButtonOptions = calculateAmountOfOptionButtons(
            data.nativeEvent.layout.width,
            isMiddleScreen,
            isMobile
        )
        setAmountOfButtonOptions(amountOfButtonOptions)
    }

    const hasRequiredData = defaultAssistant && defaultAssistant.uid && loggedUser && loggedUser.defaultProjectId

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
                <TouchableOpacity style={localStyles.collapsedRow} onPress={() => setIsCollapsed(false)}>
                    <View style={localStyles.collapsedLeft}>
                        <AssistantAvatar
                            photoURL={
                                lineAssistant?.photoURL50 || lineAssistant?.photoURL300 || lineAssistant?.photoURL
                            }
                            assistantId={lineAssistant?.uid}
                            size={24}
                            imageStyle={localStyles.collapsedAvatar}
                        />
                        <Text numberOfLines={1} style={localStyles.collapsedAssistantName}>
                            {assistantName}
                        </Text>
                    </View>
                    {showLastComment && (
                        <View style={localStyles.collapsedTagWrapper}>
                            <LastCommentArea
                                withTopMargin={false}
                                useAssistantProjectContext={useAssistantProjectContext}
                                compact={true}
                            />
                        </View>
                    )}
                    <Icon name={'chevron-down'} size={16} color={colors.Text03} style={localStyles.chevron} />
                </TouchableOpacity>
            ) : (
                <>
                    <AssistantOptions
                        amountOfButtonOptions={amountOfButtonOptions}
                        onCollapse={() => setIsCollapsed(true)}
                    />
                    {showLastComment && (
                        <LastCommentArea withTopMargin={true} useAssistantProjectContext={useAssistantProjectContext} />
                    )}
                </>
            )}
        </View>
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
    collapsedLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
        marginRight: 10,
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
    },
    collapsedTagWrapper: {
        marginLeft: 'auto',
        marginRight: 8,
        alignItems: 'flex-end',
        maxWidth: 320,
    },
    chevron: {
        marginLeft: 0,
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
