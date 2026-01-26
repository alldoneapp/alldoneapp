import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from './Button'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'
import { updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import { getId } from '../../utils/backends/firestore'
import { getDvMainTabLink } from '../../utils/LinkingHelper'

export default function TranscribeButton({ task, projectId, disabled, style, shortcutText, onDismissPopup }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const buttonRef = React.useRef(null)
    const [isProcessing, setIsProcessing] = useState(false)

    const getNoteUrl = noteId => {
        return `${window.location.origin}${getDvMainTabLink(projectId, noteId, 'notes')}?autoStartTranscription=true`
    }

    const startTranscription = () => {
        if (disabled || isProcessing) return

        console.log('[TranscribeButton] Starting transcription for task:', task?.id)

        // Dismiss the edit mode popup FIRST
        if (onDismissPopup) {
            console.log('[TranscribeButton] Dismissing popup')
            onDismissPopup()
        }

        setIsProcessing(true)

        let noteId = task?.noteId
        console.log('[TranscribeButton] Task noteId:', noteId)

        if (noteId) {
            // Task already has a note, open it in new tab
            const url = getNoteUrl(noteId)
            console.log('[TranscribeButton] Opening existing note in new tab:', url)
            window.open(url, '_blank')
            setIsProcessing(false)
        } else {
            // Create new note and open it immediately
            console.log('[TranscribeButton] Creating new note...')
            const newNote = TasksHelper.getNewDefaultNote()
            const generatedId = getId()
            newNote.id = generatedId
            newNote.parentObject = { type: 'tasks', id: task.id }
            newNote.linkedParentTasksIds = [task.id]
            newNote.title = task.name

            // Open new tab immediately (before async operations to avoid popup blocker)
            const url = getNoteUrl(generatedId)
            console.log('[TranscribeButton] Opening new note in new tab:', url)
            window.open(url, '_blank')

            // Create note in background
            updateTaskData(projectId, task.id, { noteId: generatedId })
            uploadNewNote(projectId, newNote)
            setIsProcessing(false)
        }
    }

    return (
        <Hotkeys
            keyName={`alt+${shortcutText}`}
            disabled={disabled || isProcessing}
            onKeyDown={(sht, event) => execShortcutFn(buttonRef.current, startTranscription, event)}
            filter={e => true}
        >
            <Button
                ref={buttonRef}
                title={smallScreen ? null : translate('Transcribe')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={'mic'}
                buttonStyle={style}
                onPress={startTranscription}
                disabled={disabled || isProcessing}
                shortcutText={shortcutText}
                processing={isProcessing}
                processingTitle={translate('Creating Note') + '...'}
            />
        </Hotkeys>
    )
}
