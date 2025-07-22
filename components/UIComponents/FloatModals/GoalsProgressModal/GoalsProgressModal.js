import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import ProgressItem from './ProgressItem'
import { progressData, dynamicData } from '../../../GoalsView/GoalsHelper'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Line from '../GoalMilestoneModal/Line'
import CommentInfo from './CommentInfo'
import EditForm from '../RichCommentModal/EditForm'
import AttachmentsSelectorModal from '../AttachmentsSelectorModal'
import { insertAttachmentInsideEditor } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import Button from '../../../UIControls/Button'
import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'
import { moveCompletedGoalInBacklogToDone } from '../../../../utils/backends/Goals/goalsFirestore'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

export default function GoalsProgressModal({ closeModal, updateProgress, progress, projectId, goal }) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const [showFileSelector, setShowFileSelector] = useState(false)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [initialComment, setInitialComment] = useState('')
    const [selectedProgress, setSelectedProgress] = useState(progress)
    const [inputIsFocused, setInputIsFocused] = useState(false)

    const editForm = useRef(null)
    const editorOpsRef = useRef([])

    useEffect(() => {
        editForm.current.blur()
    }, [])

    const updateInputFocuseState = () => {
        const inputIsFocused = document.activeElement.classList.contains('ql-editor')
        setInputIsFocused(inputIsFocused)
    }

    useEffect(() => {
        document.addEventListener('mouseup', updateInputFocuseState)
        document.addEventListener('mousedown', updateInputFocuseState)
        return () => {
            document.removeEventListener('mouseup', updateInputFocuseState)
            document.removeEventListener('mousedown', updateInputFocuseState)
        }
    })

    const [width, height] = useWindowSize()

    const toggleShowFileSelector = () => {
        if (showFileSelector || !checkIsLimitedByTraffic(projectId)) {
            const newValue = !showFileSelector
            setShowFileSelector(newValue)
            if (newValue) {
                editorOpsRef.current = []
            }
        } else {
            closeModal()
        }
    }

    const updateChanges = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            if (initialComment.trim()) {
                updateNewAttachmentsData(projectId, initialComment).then(commentWithAttachments => {
                    createObjectMessage(projectId, goal.id, commentWithAttachments, 'goals', null, null, null)
                })
            }
            updateProgress(selectedProgress, initialComment.trim() !== '')
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        const ops = editor.getContents().ops
        editorOpsRef.current = ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    const markAsDone = () => {
        moveCompletedGoalInBacklogToDone(projectId, goal)
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
                            title={translate('Goals completion status')}
                            description={translate('Select the percentage of completion')}
                        />
                        {progressData.map(data => (
                            <ProgressItem
                                key={data.percent}
                                progressData={data}
                                setSelectedProgress={setSelectedProgress}
                                selectedProgress={selectedProgress}
                                projectId={projectId}
                                useProjectColor={true}
                                disabledShorcut={inputIsFocused}
                            />
                        ))}
                        <Line />
                        <ProgressItem
                            progressData={dynamicData}
                            setSelectedProgress={setSelectedProgress}
                            selectedProgress={selectedProgress}
                            projectId={projectId}
                            useProjectColor={true}
                            disabledShorcut={inputIsFocused}
                        />
                        <Line />
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
                            objectType="goals"
                            hideDoneButton={true}
                            objectId={goal.id}
                        />
                        <Line style={localStyles.line} />
                        <View style={localStyles.buttonContainer}>
                            {false && goal.completionMilestoneDate === BACKLOG_DATE_NUMERIC && (
                                <Button
                                    buttonStyle={{ marginRight: 8 }}
                                    title={translate('Mark as done')}
                                    type={'secondary'}
                                    onPress={markAsDone}
                                />
                            )}
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
