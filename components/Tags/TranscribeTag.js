import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'
import { updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import Backend from '../../utils/BackendBridge'
import { getId } from '../../utils/backends/firestore'
import { getDvMainTabLink } from '../../utils/LinkingHelper'

export default function TranscribeTag({ task, projectId, containerStyle, disabled }) {
    const getNoteUrl = noteId => {
        return `${window.location.origin}${getDvMainTabLink(projectId, noteId, 'notes')}?autoStartTranscription=true`
    }

    const startTranscription = () => {
        if (disabled) return

        let noteId = task.noteId
        if (noteId) {
            // Task already has a note, just open it
            window.open(getNoteUrl(noteId), '_blank')
        } else {
            // Create new note and open it immediately
            const newNote = TasksHelper.getNewDefaultNote()
            const generatedId = getId()
            newNote.id = generatedId
            newNote.parentObject = { type: 'tasks', id: task.id }
            newNote.linkedParentTasksIds = [task.id]
            newNote.title = task.name

            // Open the new tab immediately
            window.open(getNoteUrl(generatedId), '_blank')

            // Create the note in the background (no await needed)
            updateTaskData(projectId, task.id, { noteId: generatedId })
            uploadNewNote(projectId, newNote)
        }
    }

    return (
        <TouchableOpacity
            disabled={disabled}
            onPress={startTranscription}
            style={[localStyles.container, containerStyle]}
        >
            <Icon name={'mic'} size={16} color={colors.White} style={localStyles.icon} />
            <Text style={[localStyles.text, windowTagStyle()]}>Transcribe</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Blue,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 8,
    },
    icon: {
        marginRight: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.White,
        marginVertical: 1,
    },
})
