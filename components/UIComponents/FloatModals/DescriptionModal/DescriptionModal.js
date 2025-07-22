import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import EditForm from './EditForm'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import AttachmentsSelectorModal from '../AttachmentsSelectorModal'
import { insertAttachmentInsideEditor } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { exportRef } from '../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { removeModal, storeModal, TASK_DESCRIPTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import {
    FEED_TASK_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_WORKSTREAM_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_ASSISTANT_OBJECT_TYPE,
} from '../../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import ModalHeader from '../ModalHeader'

export default function DescriptionModal({
    projectId,
    object,
    closeModal,
    updateDescription,
    objectType,
    disabledTags,
    disabledAttachments,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [showFileSelector, setShowFileSelector] = useState(false)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [initialDescription, setInitialDescription] = useState(object.description || '')
    const editForm = useRef(null)
    const editorOpsRef = useRef([])

    const toggleShowFileSelector = () => {
        if (showFileSelector || !checkIsLimitedByTraffic(projectId)) {
            const newValue = !showFileSelector
            setShowFileSelector(state => !state)
            if (newValue) {
                editorOpsRef.current = []
            }
        } else {
            closeModal()
        }
    }

    const done = description => {
        if (disabledAttachments) {
            updateDescription(description)
            closeModal()
        } else {
            updateNewAttachmentsData(projectId, description).then(finalDescription => {
                updateDescription(finalDescription)
                closeModal()
            })
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        editorOpsRef.current = editor.getContents().ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    useEffect(() => {
        setTimeout(() => {
            exportRef?.getEditor()?.focus()
            editForm?.current?.focus()
        }, 1000)
    }, [])

    useEffect(() => {
        storeModal(TASK_DESCRIPTION_MODAL_ID)
        return () => {
            removeModal(TASK_DESCRIPTION_MODAL_ID)
        }
    }, [])

    const getTitle = () => {
        let type = ''
        if (objectType === FEED_TASK_OBJECT_TYPE) {
            type = 'Task'
        } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
            type = 'Goal'
        } else if (objectType === FEED_WORKSTREAM_OBJECT_TYPE) {
            type = 'Workstream'
        } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
            type = 'Skill'
        } else if (objectType === FEED_ASSISTANT_OBJECT_TYPE) {
            type = 'Assistant'
        }

        return translate(`${type} description`)
    }

    const getText = () => {
        let type = ''
        if (objectType === FEED_TASK_OBJECT_TYPE) {
            type = 'task'
        } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
            type = 'goal'
        } else if (objectType === FEED_WORKSTREAM_OBJECT_TYPE) {
            type = 'workstream'
        } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
            type = 'skill'
        } else if (objectType === FEED_ASSISTANT_OBJECT_TYPE) {
            type = 'assistant'
        }

        return translate(`Here you can enter in details what this ${type} is about`)
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
                <View style={[localStyles.container, applyPopoverWidth()]}>
                    <View style={localStyles.innerContainer}>
                        <ModalHeader title={getTitle()} description={getText()} closeModal={closeModal} />
                        <EditForm
                            ref={editForm}
                            projectId={projectId}
                            onSuccess={done}
                            currentDescription={initialDescription}
                            toggleShowFileSelector={toggleShowFileSelector}
                            setEditor={setEditor}
                            editor={editor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={inputCursorIndex}
                            initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                            setInitialDescription={setInitialDescription}
                            loggedUserId={loggedUserId}
                            userIsAnonymous={isAnonymous}
                            enableAttachments={!disabledAttachments}
                            isCalendarTask={object.calendarData}
                            disabledTags={disabledTags}
                            externalEditorId={`${object.uid || object.id}Description`}
                        />
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 8,
        paddingVertical: 8,
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
    innerContainer: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
})
