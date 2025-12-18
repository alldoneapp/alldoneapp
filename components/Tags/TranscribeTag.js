import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch } from 'react-redux'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import NavigationService from '../../utils/NavigationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'
import { updateTaskData } from '../../utils/backends/Tasks/tasksFirestore'
import { setSelectedNote } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import { getId } from '../../utils/backends/firestore'

export default function TranscribeTag({ task, projectId, containerStyle, disabled }) {
    const dispatch = useDispatch()

    const startTranscription = async () => {
        if (disabled) return

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
        <TouchableOpacity
            disabled={disabled}
            onPress={startTranscription}
            style={[localStyles.container, containerStyle]}
        >
            <Icon name={'microphone'} size={16} color={colors.White} style={localStyles.icon} />
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
