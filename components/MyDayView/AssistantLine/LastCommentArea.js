import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getCommentData } from './AssistantOptions/helper'
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } from '../../../utils/backends/Chats/chatsComments'
import LastComment from './LastComment/LastComment'

export default function LastCommentArea() {
    const defaultAssistant = useSelector(state => state.defaultAssistant.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const lastAssistantCommentData = useSelector(
        state => state.loggedUser.lastAssistantCommentData[project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]
    )
    const projectChatLastNotification = useSelector(
        state => state.projectChatLastNotification[project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY]
    )
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

    const { commentCreator, commentProject, isAssistant } = getCommentData(
        project,
        currentProjectChatLastNotification,
        currentLastAssistantCommentData,
        defaultAssistant,
        defaultProjectId
    )

    if (!commentProject || !commentCreator) {
        return null
    }

    return (
        <View style={localStyles.container}>
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
        marginTop: 32,
    },
})
