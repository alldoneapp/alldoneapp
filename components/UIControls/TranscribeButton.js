import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from './Button'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'
import { updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import { setSelectedNavItem } from '../../redux/actions'
import { DV_TAB_TASK_NOTE } from '../../utils/TabNavigationConstants'
import { getId } from '../../utils/backends/firestore'

export default function TranscribeButton({ task, projectId, disabled, style, shortcutText, onDismissPopup }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const buttonRef = React.useRef(null)
    const [isProcessing, setIsProcessing] = useState(false)

    const startTranscription = async () => {
        if (disabled || isProcessing) return

        console.log('[TranscribeButton] Starting transcription for task:', task?.id)

        // Dismiss the edit mode popup FIRST before any async operations
        if (onDismissPopup) {
            console.log('[TranscribeButton] Dismissing popup')
            onDismissPopup()
        }

        setIsProcessing(true)

        try {
            let noteId = task?.noteId
            console.log('[TranscribeButton] Task noteId:', noteId)

            // If no note exists, create one first
            if (!noteId) {
                console.log('[TranscribeButton] Creating new note...')
                const newNote = TasksHelper.getNewDefaultNote()
                const generatedId = getId()
                newNote.id = generatedId
                newNote.parentObject = { type: 'tasks', id: task.id }
                newNote.linkedParentTasksIds = [task.id]
                newNote.title = task.name

                console.log('[TranscribeButton] Updating task with noteId...')
                // Update task with noteId
                await updateTaskData(projectId, task.id, { noteId: generatedId })

                console.log('[TranscribeButton] Uploading new note...')
                // Upload new note
                await uploadNewNote(projectId, newNote)

                noteId = generatedId
            }

            // Navigate to TaskDetailedView and select the Notes tab
            console.log('[TranscribeButton] Navigating to TaskDetailedView with Notes tab...')
            NavigationService.navigate('TaskDetailedView', {
                task: { ...task, noteId }, // Include the noteId in case we just created it
                projectId: projectId,
                autoStartTranscription: true,
            })
            dispatch(setSelectedNavItem(DV_TAB_TASK_NOTE))

            console.log('[TranscribeButton] Navigation complete')
        } catch (error) {
            console.error('[TranscribeButton] Error:', error)
        } finally {
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
