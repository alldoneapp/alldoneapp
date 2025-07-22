import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import { useDispatch, useSelector } from 'react-redux'
import RichCommentModal from '../UIComponents/FloatModals/RichCommentModal/RichCommentModal'
import { updateTaskSuggestedCommentModalData } from '../../redux/actions'
import { FORDWARD_COMMENT, updateNewAttachmentsData } from '../Feeds/Utils/HelperFunctions'
import Popover from 'react-tiny-popover'
import Icon from '../Icon'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import ObjectHeaderParser from '../Feeds/TextParser/ObjectHeaderParser'
import { getWorkstreamById, WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { createObjectMessage } from '../../utils/backends/Chats/chatsComments'

export default function TaskSuggestedComment({ task, taskName, projectId }) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])

    const assignee =
        TasksHelper.getUserInProject(projectId, task.userId) ||
        TasksHelper.getContactInProject(projectId, task.userId) ||
        getWorkstreamById(projectId, task.userId)

    const isWorkstream = assignee.uid.startsWith(WORKSTREAM_ID_PREFIX)

    const onSubmit = comment => {
        if (!isQuillTagEditorOpen && !isMentionModalOpen && comment) {
            updateNewAttachmentsData(projectId, comment).then(commentWithAttachments => {
                createObjectMessage(projectId, task.id, commentWithAttachments, 'tasks', FORDWARD_COMMENT, null, null)
            })
        }
    }
    const closeModal = () => {
        if (!isQuillTagEditorOpen && !isMentionModalOpen) {
            setTimeout(() => {
                dispatch(updateTaskSuggestedCommentModalData(false, '', null, ''))
            }, 500)
        }
    }

    const renderAvatar = (style = {}) => {
        return isWorkstream ? (
            <Icon size={20} name="workstream" color={'#ffffff'} style={style} />
        ) : assignee.photoURL != null && assignee.photoURL !== '' ? (
            <Image source={{ uri: assignee.photoURL }} style={style} />
        ) : (
            <View style={style}>
                <SVGGenericUser width={20} height={20} svgid={`cicp_p_${assignee.uid}`} />
            </View>
        )
    }

    const getAssigneeName = () => {
        return isWorkstream ? `${assignee.displayName} workstream` : assignee.displayName.split(' ')[0]
    }

    return (
        <View style={[localStyles.container]}>
            <Popover isOpen={true} content={null} onClickOutside={closeModal}>
                <RichCommentModal
                    projectId={projectId}
                    objectType={'tasks'}
                    objectId={task.id}
                    closeModal={closeModal}
                    processDone={onSubmit}
                    inTaskModal
                    inSuggested
                    userGettingKarmaId={task.userId}
                    externalAssistantId={task.assistantId}
                    customHeader={
                        <View style={{ marginBottom: 20 }}>
                            <View style={{ flexDirection: 'row' }}>
                                {renderAvatar(localStyles.logo)}
                                <Text style={[styles.title7, { color: '#ffffff' }]}>
                                    Comment for {getAssigneeName()}
                                </Text>
                            </View>
                            <Text style={[styles.body2, { color: colors.Text03 }]}>
                                You are suggesting this task to {getAssigneeName()}, please enter a comment explaining
                                about it.
                            </Text>
                            <View style={localStyles.taskTitle}>
                                <Icon name={'check-square'} size={20} color={'#fff'} />
                                <ObjectHeaderParser
                                    text={taskName}
                                    projectId={projectId}
                                    entryExternalStyle={{ color: '#fff' }}
                                />
                                {renderAvatar([localStyles.logo, { marginLeft: 'auto' }])}
                            </View>
                        </View>
                    }
                />
            </Popover>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
    },
    taskTitle: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 28,
        marginBottom: 16,
    },
    logo: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginRight: 8,
    },
})
