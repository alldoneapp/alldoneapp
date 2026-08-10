import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
    insertAttachmentInsideEditor,
    RECORD_SCREEN_MODAL_ID,
    RECORD_VIDEO_MODAL_ID,
} from '../../Feeds/CommentsTextInput/textInputHelper'
import { MENTION_MODAL_ID } from '../../ModalsManager/modalsManager'
import AddTopicModal from './AddTopicModal'
import AttachmentsSelectorModal from '../../UIComponents/FloatModals/AttachmentsSelectorModal'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
import PrivacyModal from '../../UIComponents/FloatModals/PrivacyModal/PrivacyModal'
import { FEED_CHAT_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import { getId } from '../../../utils/backends/firestore'
import { setAssistantEnabled, startLoadingData, stopLoadingData } from '../../../redux/actions'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'
import { createChat } from '../../../utils/backends/Chats/chatsComments'
import { createObjectMessage } from '../../../utils/backends/Chats/chatsComments'
import { getDefaultAssistantInProjectById } from '../../AdminPanel/Assistants/assistantsHelper'

export default function NewTopic({ projectId, propFiles, close }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const { uid } = useSelector(state => state.loggedUser)
    const openModals = useSelector(state => state.openModals)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const textRef = useRef('')
    const showFileSelectorRef = useRef(false)
    const showPrivacyModalRef = useRef(false)
    const isPrivateRef = useRef(false)
    const isPublicForRef = useRef([FEED_PUBLIC_FOR_ALL, uid])
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [renderFlag, setRenderFlag] = useState(false)
    const [botIsActive, setBotIsActive] = useState(false)
    const editorOpsRef = useRef([])
    const topicObject = {
        isPrivate: isPrivateRef.current,
        isPublicFor: isPublicForRef.current,
        creatorId: uid,
    }

    const forceRender = () => {
        setRenderFlag(!renderFlag)
    }

    const closeModal = () => {
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID]
        ) {
            close()
        }
    }

    const setShowFileSelector = () => {
        if (showFileSelectorRef.current || !checkIsLimitedByTraffic(projectId)) {
            showFileSelectorRef.current = !showFileSelectorRef.current
            if (showFileSelectorRef.current) {
                editorOpsRef.current = []
            }
            forceRender()
        } else {
            closeModal()
        }
    }

    const setShowPrivacyModal = () => {
        showPrivacyModalRef.current = !showPrivacyModalRef.current
        forceRender()
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        isPrivateRef.current = isPrivate
        isPublicForRef.current = isPublicFor
        forceRender()
    }

    const onChangeText = value => {
        textRef.current = value
        forceRender()
    }

    const loadEditor = editorRef => {
        setEditor(editorRef)
        if (!editor && propFiles && propFiles.length > 0) {
            for (let i = 0; i < propFiles.length; i++) {
                const { name } = propFiles[i].file
                const uri = URL.createObjectURL(propFiles[i].file)
                insertAttachmentInsideEditor(inputCursorIndex, editorRef, name.replaceAll(/\s/g, '_'), uri)
            }
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        const ops = editor.getContents().ops
        editorOpsRef.current = ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    const onToggleBot = () => {
        setBotIsActive(state => !state)
    }

    const handleSubmit = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            dispatch(startLoadingData())
            const chatId = getId()
            const assistantId = getDefaultAssistantInProjectById(projectId)
            createChat(
                chatId,
                projectId,
                uid,
                '',
                'topics',
                'New Topic',
                isPublicForRef.current,
                '#FFFFFF',
                null,
                null,
                '',
                assistantId,
                STAYWARD_COMMENT,
                uid
            ).then(async () => {
                updateNewAttachmentsData(projectId, textRef.current).then(commentWithAttachments => {
                    createObjectMessage(projectId, chatId, commentWithAttachments, 'topics', null, null, null).then(
                        () => {
                            dispatch(stopLoadingData())
                            window.open(
                                `${window.location.origin}/projects/${projectId}/chats/${chatId}/chat`,
                                '_blank'
                            )
                        }
                    )
                })
            })

            closeModal()
        }
    }

    useEffect(() => {
        dispatch(setAssistantEnabled(false))
    }, [])

    return (
        <View>
            {showFileSelectorRef.current ? (
                <AttachmentsSelectorModal
                    closeModal={setShowFileSelector}
                    addAttachmentTag={addAttachmentTag}
                    style={[localStyles.parent, mobile && localStyles.mobile]}
                    projectId={projectId}
                />
            ) : showPrivacyModalRef.current ? (
                <PrivacyModal
                    object={topicObject}
                    objectType={FEED_CHAT_OBJECT_TYPE}
                    projectId={projectId}
                    closePopover={setShowPrivacyModal}
                    delayClosePopover={setShowPrivacyModal}
                    savePrivacyBeforeSaveObject={setPrivacy}
                    style={[localStyles.parent, mobile && localStyles.mobile]}
                />
            ) : (
                <AddTopicModal
                    projectId={projectId}
                    handleSubmit={handleSubmit}
                    onChangeText={onChangeText}
                    text={textRef.current}
                    setEditor={loadEditor}
                    isPrivate={isPrivateRef.current}
                    closeModal={closeModal}
                    setShowFileSelector={setShowFileSelector}
                    setShowPrivacyModal={setShowPrivacyModal}
                    initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                    setInputCursorIndex={setInputCursorIndex}
                    initialCursorIndex={inputCursorIndex}
                    onToggleBot={onToggleBot}
                    botIsActive={botIsActive}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        position: 'fixed',
        zIndex: 1,
        left: '48.5%',
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    mobile: {
        transform: [{ translateX: '-48.5%' }, { translateY: '-50%' }],
    },
})
