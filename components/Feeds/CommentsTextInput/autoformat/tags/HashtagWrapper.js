import React, { useState, useEffect } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import ReactQuill from 'react-quill'

import HashtagsInteractionPopup from '../../../../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import HashtagTag from './HashtagTag'
import { setSearchText, showGlobalSearchPopup, startLoadingData, stopLoadingData } from '../../../../../redux/actions'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputRefs } from '../../CustomTextInput3'
import { getQuillEditorRef } from '../../textInputHelper'
import { COLOR_KEY_4 } from '../../../../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import Backend from '../../../../../utils/BackendBridge'
import { removeColor } from '../../../../../functions/Utils/hashtagUtils'

const Delta = ReactQuill.Quill.import('delta')

export default function HashtagWrapper({ data }) {
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const projectId = useSelector(state => state.quillEditorProjectId)
    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const activeNoteId = useSelector(state => state.activeNoteId)
    const hashtagsColors = useSelector(state => state.hashtagsColors)
    const [isOpen, setIsOpen] = useState(false)

    const { text = '', id: tagId = '', editorId = '', userIdAllowedToEditTags = '' } = data
    const { editorRef } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const inReadOnlyNote = activeNoteId && (activeNoteIsReadOnly || loggedUser.isAnonymous)

    const cleanedText = removeColor(text)
    const parsedText = cleanedText.toLowerCase()
    const colorKey = hashtagsColors?.[projectId]?.[parsedText] || COLOR_KEY_4

    const openModal = () => {
        if (
            !inReadOnlyNote &&
            (!userIdAllowedToEditTags ||
                userIdAllowedToEditTags === 'null' ||
                userIdAllowedToEditTags === 'undefined' ||
                userIdAllowedToEditTags === loggedUser.uid)
        ) {
            setIsOpen(true)
        } else {
            performAction()
        }
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const performAction = () => {
        dispatch([setSearchText(`#${text}`), showGlobalSearchPopup(false)])
        closeModal()
    }

    const updateHashtag = (newText, newColorKey) => {
        Backend.updateHastagsColors(projectId, newText, newColorKey, colorKey !== newColorKey)
        const editor = editorRef.getEditor()
        closeModal()
        setTimeout(function () {
            const ops = editor.getContents().ops
            let tagPosition = 0
            for (let i = 0; i < ops.length; i++) {
                const insert = ops[i].insert

                if (insert && insert.hashtag && insert.hashtag.id === tagId) {
                    if (insert.hashtag.text !== newText) {
                        const hashtag = { ...insert.hashtag }
                        hashtag.text = newText

                        const delta = new Delta()
                        delta.retain(tagPosition)
                        delta.delete(1)
                        delta.insert({ hashtag })
                        editor.updateContents(delta, 'user')
                    }
                    editor.setSelection(tagPosition + 1, 0, 'user')
                    break
                }

                tagPosition += typeof insert === 'string' ? insert.length : 1
            }

            if (colorKey !== newColorKey) {
                editor.history.stack.undo.push({
                    redo: {
                        objectId: projectId,
                        type: 'hashtagColor',
                        colorKey: newColorKey,
                        text: newText,
                    },
                    undo: {
                        objectId: projectId,
                        type: 'hashtagColor',
                        colorKey: colorKey,
                        text: newText,
                    },
                })
            }
        }, 400)
    }

    useEffect(() => {
        if (!virtualQuillLoaded) {
            const cleanedText = removeColor(text)
            dispatch(startLoadingData())
            Backend.watchHastagsColors(projectId, tagId, cleanedText, () => dispatch(stopLoadingData()))
            return () => {
                Backend.unwatchHastagsColors(tagId)
            }
        }
    }, [projectId, text, tagId])

    return (
        <Popover
            content={
                <HashtagsInteractionPopup
                    text={text}
                    performAction={performAction}
                    closeModal={closeModal}
                    updateValue={updateHashtag}
                    initialColorKey={colorKey}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <HashtagTag disabled={loggedUser.isAnonymous} text={text} onPress={openModal} colorKey={colorKey} />
        </Popover>
    )
}
