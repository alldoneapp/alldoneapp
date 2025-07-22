import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import { progressData } from '../../../../GoalsView/GoalsHelper'
import useWindowSize from '../../../../../utils/useWindowSize'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { insertAttachmentInsideEditor } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../../Feeds/Utils/HelperFunctions'
import Button from '../../../../UIControls/Button'
import { MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import ProgressItem from '../../../../UIComponents/FloatModals/GoalsProgressModal/ProgressItem'
import Line from '../../../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import CommentInfo from '../../../../UIComponents/FloatModals/GoalsProgressModal/CommentInfo'
import EditForm from '../../../../UIComponents/FloatModals/RichCommentModal/EditForm'
import AttachmentsSelectorModal from '../../../../UIComponents/FloatModals/AttachmentsSelectorModal'
import { createObjectMessage } from '../../../../../utils/backends/Chats/chatsComments'

export default function SkillCompletionModal({ closeModal, changeCompletion, completion, projectId, skillId }) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const [showFileSelector, setShowFileSelector] = useState(false)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [initialComment, setInitialComment] = useState('')
    const [selectedCompletion, setSelectedCompletion] = useState(completion)

    const editForm = useRef(null)
    const editorOpsRef = useRef([])

    useEffect(() => {
        editForm.current.blur()
    }, [])

    const [width, height] = useWindowSize()

    const toggleShowFileSelector = () => {
        const newValue = !showFileSelector
        setShowFileSelector(newValue)
        if (newValue) editorOpsRef.current = []
    }

    const updateChanges = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            if (initialComment.trim()) {
                updateNewAttachmentsData(projectId, initialComment).then(commentWithAttachments => {
                    createObjectMessage(projectId, skillId, commentWithAttachments, 'skills', null, null, null)
                })
            }
            changeCompletion(selectedCompletion, initialComment.trim() !== '')
            closeModal()
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        const ops = editor.getContents().ops
        editorOpsRef.current = ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    return (
        <View>
            {showFileSelector ? (
                <AttachmentsSelectorModal
                    closeModal={toggleShowFileSelector}
                    addAttachmentTag={addAttachmentTag}
                    projectId={projectId}
                />
            ) : (
                <View
                    style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}
                >
                    <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                        <ModalHeader
                            closeModal={closeModal}
                            title={translate('Skills completion status')}
                            description={translate('Select the percentage of completion')}
                        />
                        {progressData.map(data => (
                            <ProgressItem
                                key={data.percent}
                                progressData={data}
                                setSelectedProgress={setSelectedCompletion}
                                selectedProgress={selectedCompletion}
                            />
                        ))}
                        <Line style={localStyles.line} />
                        <CommentInfo />
                        <EditForm
                            ref={editForm}
                            projectId={projectId}
                            containerStyle={localStyles.editorContainer}
                            currentComment={initialComment}
                            toggleShowFileSelector={toggleShowFileSelector}
                            setEditor={setEditor}
                            editor={editor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={inputCursorIndex}
                            initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                            setInitialComment={setInitialComment}
                            objectType="skills"
                            hideDoneButton={true}
                            objectId={skillId}
                        />
                        <Line style={localStyles.line} />
                        <View style={localStyles.buttonContainer}>
                            <Button title={translate('Update')} type={'primary'} onPress={updateChanges} />
                        </View>
                    </CustomScrollView>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    line: {
        marginTop: 16,
    },
    editorContainer: {
        marginBottom: 0,
        marginTop: 8,
        marginHorizontal: -8,
    },
    buttonContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
