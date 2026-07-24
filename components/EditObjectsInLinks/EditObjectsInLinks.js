import React, { useEffect } from 'react'
import EditGoalLink from './Goals/EditGoalLink'
import EditAssistantLink from './Assistant/EditAssistantLink'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import CloseButton from '../FollowUp/CloseButton'
import { removeModal, storeModal, TAGS_EDIT_OBJECT_MODAL_ID } from '../ModalsManager/modalsManager'
import { hideFloatPopup, setIsQuillTagEditorOpen, showFloatPopup } from '../../redux/actions'
import { useDispatch } from 'react-redux'
import EditContactLink from './Contacts/EditContactLink'
import EditUserLink from './Contacts/EditUserLink'
import EditNoteLink from './Notes/EditNoteLink'
import ManageTaskModal from '../UIComponents/FloatModals/ManageTaskModal/ManageTaskModal'
import Icon from '../Icon'
import EditProjectLink from './Projects/EditProjectLink'
import EditChatLink from './Chats/EditChatLink'
import EditSkillLink from './Skills/EditSkillLink'

export default function EditObjectsInLinks({
    projectId,
    objectType,
    objectData,
    userIsMember,
    closeModal,
    editorId,
    editorRef,
    tagId,
    objectUrl,
    isPrivate = false,
}) {
    const dispatch = useDispatch()

    useEffect(() => {
        storeModal(TAGS_EDIT_OBJECT_MODAL_ID)
        dispatch(showFloatPopup())

        return () => {
            onClose()
        }
    }, [])

    const onClose = () => {
        removeModal(TAGS_EDIT_OBJECT_MODAL_ID)
        dispatch(hideFloatPopup())
    }

    const renderComponentToEditObject = () => {
        switch (objectType) {
            case 'task': {
                return (
                    <ManageTaskModal
                        projectId={projectId}
                        closeModal={closeModal}
                        editorRef={editorRef}
                        noteId={editorId}
                        editing={objectData.id}
                        task={objectData}
                        tagId={tagId}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'assistant': {
                return (
                    <EditAssistantLink
                        projectId={projectId}
                        assistantData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'goal': {
                return (
                    <EditGoalLink
                        projectId={projectId}
                        goalData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'skill': {
                return (
                    <EditSkillLink
                        projectId={projectId}
                        skillData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'note': {
                return (
                    <EditNoteLink
                        projectId={projectId}
                        noteData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'people': {
                return userIsMember ? (
                    <EditUserLink
                        projectId={projectId}
                        contactData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                ) : (
                    <EditContactLink
                        projectId={projectId}
                        contactData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
            case 'project': {
                return <EditProjectLink projectData={objectData} closeModal={closeModal} objectUrl={objectUrl} />
            }
            case 'topic': {
                return (
                    <EditChatLink
                        projectId={projectId}
                        chatData={objectData}
                        closeModal={closeModal}
                        objectUrl={objectUrl}
                    />
                )
            }
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]} nativeID={TAGS_EDIT_OBJECT_MODAL_ID}>
            {isPrivate ? (
                <View style={localStyles.privateContainer}>
                    <View style={localStyles.headingContainer}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>Private object</Text>
                    </View>

                    <Text style={[localStyles.privateTextContainer, localStyles.privateText]}>
                        <Icon name={'info'} size={18} color={colors.Text03} style={{ marginRight: 8 }} />
                        <Text style={localStyles.privateText}>Looks like you do not have access to this object.</Text>
                    </Text>
                </View>
            ) : (
                renderComponentToEditObject()
            )}

            {isPrivate && <CloseButton close={closeModal} style={localStyles.closeButton} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 0,
        paddingVertical: 0,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        height: 'auto',
        maxWidth: 305,
        minWidth: 305,
    },
    privateContainer: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    headingContainer: {
        flexDirection: 'row',
        paddingHorizontal: 8,
        paddingTop: 8,
    },
    privateTextContainer: {
        paddingHorizontal: 8,
        paddingBottom: 8,
    },
    privateText: {
        ...styles.body2,
        color: colors.Text03,
        textAlignVertical: 'text-bottom',
    },
    closeButton: {
        top: 8,
        right: 8,
    },
})
