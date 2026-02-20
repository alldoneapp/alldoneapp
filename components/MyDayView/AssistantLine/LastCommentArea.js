import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { getAssistantLineData, getCommentData } from './AssistantOptions/helper'
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } from '../../../utils/backends/Chats/chatsComments'
import LastComment from './LastComment/LastComment'
import { translate } from '../../../i18n/TranslationService'
import { colors } from '../../styles/global'

export default function LastCommentArea({
    withTopMargin = true,
    useCardBackground = false,
    useAssistantProjectContext = true,
    useGlobalLatestComment = false,
}) {
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const { assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        defaultAssistantId,
        defaultProjectId
    )
    const project = useAssistantProjectContext ? assistantProject || selectedProject : selectedProject
    const projectKey = useGlobalLatestComment
        ? ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
        : useAssistantProjectContext
        ? assistantProjectId || project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
        : project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
    const lastAssistantCommentData = useSelector(state => state.loggedUser.lastAssistantCommentData[projectKey])
    const projectChatLastNotification = useSelector(state => state.projectChatLastNotification[projectKey])
    const [aModalIsOpen, setAModalIsOpen] = useState(false)
    const [currentProjectChatLastNotification, setCurrentProjectChatLastNotification] = useState(
        projectChatLastNotification
    )
    const [currentLastAssistantCommentData, setCurrentLastAssistantCommentData] = useState(lastAssistantCommentData)

    useEffect(() => {
        if (!aModalIsOpen) {
            setCurrentProjectChatLastNotification(projectChatLastNotification)
            setCurrentLastAssistantCommentData(lastAssistantCommentData)
        }
    }, [aModalIsOpen, projectChatLastNotification, lastAssistantCommentData])

    const { commentCreator, commentProject } = getCommentData(
        project,
        currentProjectChatLastNotification,
        currentLastAssistantCommentData,
        defaultAssistantId,
        defaultProjectId
    )

    if (!commentProject || !commentCreator) {
        return null
    }

    return (
        <View
            style={[
                localStyles.container,
                withTopMargin && localStyles.containerWithTopMargin,
                useCardBackground && localStyles.cardContainer,
            ]}
        >
            <Text style={localStyles.title}>{translate('Last comment')}</Text>
            <LastComment
                project={commentProject}
                setAModalIsOpen={setAModalIsOpen}
                currentProjectChatLastNotification={currentProjectChatLastNotification}
                currentLastAssistantCommentData={currentLastAssistantCommentData}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    containerWithTopMargin: {
        marginTop: 24,
    },
    cardContainer: {
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        paddingLeft: 10,
        paddingRight: 16,
        paddingTop: 14,
        paddingBottom: 12,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.Text03,
        marginBottom: 8,
        textAlign: 'center',
    },
})
