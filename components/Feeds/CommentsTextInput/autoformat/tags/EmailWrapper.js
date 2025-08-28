import React, { useState } from 'react'
import { Linking } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import ReactQuill from 'react-quill'

import TagsInteractionPopup from '../../../../NotesView/NotesDV/EditorView/TagsInteractionPopup'
import EmailTag from './EmailTag'
import { colors } from '../../../../styles/global'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputRefs } from '../../CustomTextInput3'
import { REGEX_EMAIL } from '../../../Utils/HelperFunctions'
import { getQuillEditorRef } from '../../textInputHelper'

const Delta = ReactQuill.Quill.import('delta')

export default EmailWrapper = ({ data }) => {
    console.log('EmailWrapper received data:', data)
    const { text = '', id: tagId = '', editorId = '', userIdAllowedToEditTags = '' } = data

    // Clean the email text by removing any trailing punctuation
    const cleanedText = text.replace(/[,.]$/, '')
    console.log('EmailWrapper cleaned text:', cleanedText)

    const loggedUser = useSelector(state => state.loggedUser)
    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const activeNoteId = useSelector(state => state.activeNoteId)
    const { editorRef } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const [isOpen, setIsOpen] = useState(false)
    const inReadOnlyNote = activeNoteId && (activeNoteIsReadOnly || loggedUser.isAnonymous)

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
        closeModal()
        Linking.openURL(`mailto:${cleanedText}?subject=Change me!`)
    }

    const updateEmail = newEmail => {
        console.log('Updating email to:', newEmail)
        const editor = editorRef.getEditor()
        closeModal()
        setTimeout(function () {
            const ops = editor.getContents().ops
            let tagPosition = 0
            for (let i = 0; i < ops.length; i++) {
                const insert = ops[i].insert

                if (insert && insert.email && insert.email.id === tagId) {
                    const email = { ...insert.email }
                    email.text = newEmail

                    const delta = new Delta()
                    delta.retain(tagPosition)
                    delta.delete(1)
                    delta.insert({ email })
                    editor.updateContents(delta, 'user')
                    editor.setSelection(tagPosition + 1, 0, 'user')
                    break
                }

                tagPosition += typeof insert === 'string' ? insert.length : 1
            }
        }, 400)
    }

    const isValidEmail = email => {
        return email ? REGEX_EMAIL.test(email) : true
    }

    return (
        <Popover
            content={
                <TagsInteractionPopup
                    ico="mail"
                    inputTextColor={colors.UtilityYellow200}
                    initialValue={cleanedText}
                    performAction={performAction}
                    closeModal={closeModal}
                    updateValue={updateEmail}
                    textIsValid={isValidEmail}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <EmailTag value={cleanedText} onPress={openModal} />
        </Popover>
    )
}
