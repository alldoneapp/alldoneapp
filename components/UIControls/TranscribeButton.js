import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from './Button'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'
import { updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import { setSelectedNote } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { getId } from '../../utils/backends/firestore'

export default function TranscribeButton({ task, projectId, disabled, style, shortcutText, onDismissPopup }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const buttonRef = React.useRef(null)

    const startTranscription = async () => {
        if (disabled) return

        // Dismiss the edit mode popup if provided
        if (onDismissPopup) onDismissPopup()

        let noteId = task.noteId
        if (noteId) {
            const note = await Backend.getNoteMeta(projectId, noteId)
            if (note) {
                dispatch(setSelectedNote(note))
                NavigationService.navigate('NotesDetailedView', {
                    noteId: note.id,
                    projectId: projectId,
                    autoStartTranscription: true,
                })
            }
        } else {
            const newNote = TasksHelper.getNewDefaultNote()
            const generatedId = getId()
            newNote.id = generatedId
            newNote.parentObject = { type: 'tasks', id: task.id }
            newNote.linkedParentTasksIds = [task.id]
            newNote.title = task.name

            // Optimistically update
            await updateTaskData(projectId, task.id, { noteId: generatedId })

            // Upload note
            await uploadNewNote(projectId, newNote)

            // Setup navigation
            const note = await Backend.getNoteMeta(projectId, generatedId)
            if (note) {
                dispatch(setSelectedNote(note))
                NavigationService.navigate('NotesDetailedView', {
                    noteId: generatedId,
                    projectId: projectId,
                    autoStartTranscription: true,
                })
            }
        }
    }

    return (
        <Hotkeys
            keyName={`alt+${shortcutText}`}
            disabled={disabled}
            onKeyDown={(sht, event) => execShortcutFn(buttonRef.current, startTranscription, event)}
            filter={e => true}
        >
            <Button
                ref={buttonRef}
                title={smallScreen ? null : translate('Transcribe')}
                type={'ghost'}
                noBorder={smallScreen}
                icon={'microphone'}
                buttonStyle={style}
                onPress={startTranscription}
                disabled={disabled}
                shortcutText={shortcutText}
            />
        </Hotkeys>
    )
}
