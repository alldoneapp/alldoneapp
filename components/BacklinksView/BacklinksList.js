import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { resetLoadingData, setBacklinkSection, setInBacklinksView, startLoadingData } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import NotesItem from '../NotesView/NotesItem'
import DismissibleItem from '../UIComponents/DismissibleItem'
import { isSomeEditOpen } from '../NotesView/NotesHelper'
import EditNote from '../NotesView/EditNote'
import BacklinkTaskContainer from './BacklinkTaskContainer'

const BacklinksList = ({ listType, project, linkedParentObject, setAmountObj }) => {
    const dispatch = useDispatch()
    const currentUser = useSelector(state => state.currentUser)
    const [notes, setNotes] = useState([])
    const [tasks, setTasks] = useState([])
    const [taskAmount, setTaskAmount] = useState(null)
    const [noteAmount, setNoteAmount] = useState(null)
    const dismissibleRefs = useRef({}).current

    const updateNotes = notesDocs => {
        const notesList = []
        for (let noteDoc of notesDocs) {
            const note = Backend.mapNoteData(noteDoc.id, noteDoc.data())
            notesList.push(note)
        }
        notesList.sort((a, b) => (a.lastEditionDate - b.lastEditionDate) * -1)
        setNotes(notesList)
        setNoteAmount(notesList.length)
        setAmountObj(prevState => {
            return { ...prevState, notes: notesList.length }
        })
        dispatch(resetLoadingData())
    }

    const updateTasks = tasksDocs => {
        const taskList = []
        for (let taskDoc of tasksDocs) {
            const task = Backend.mapTaskData(taskDoc.id, taskDoc.data())
            taskList.push(task)
        }
        taskList.sort((a, b) => (a.created - b.created) * -1)

        setTasks(taskList)
        setTaskAmount(taskList.length)
        setAmountObj(prevState => {
            return { ...prevState, tasks: taskList.length }
        })
        dispatch(resetLoadingData())
    }

    useEffect(() => {
        dispatch(startLoadingData(2))
        Backend.unwatchLinkedTasks()
        Backend.unwatchLinkedNotes(project.id, currentUser.uid)
        Backend.watchLinkedNotes(project.id, currentUser.uid, linkedParentObject, updateNotes)
        Backend.watchLinkedTasks(project.id, linkedParentObject, updateTasks)
        dispatch(setInBacklinksView(true))

        return () => {
            Backend.unwatchLinkedNotes()
            Backend.unwatchLinkedTasks()
            dispatch(setInBacklinksView(false))
        }
    }, [project.id, currentUser?.uid, linkedParentObject])

    useEffect(() => {
        if (taskAmount != null && noteAmount != null) {
            if (taskAmount === 0 && noteAmount > 0) {
                dispatch(setBacklinkSection({ index: 0, section: 'Notes' }))
            } else if (taskAmount > 0 && noteAmount === 0) {
                dispatch(setBacklinkSection({ index: 1, section: 'Tasks' }))
            }
        }
    }, [taskAmount, noteAmount])

    if (listType === 'Tasks') {
        return (
            <View style={localStyles.container}>
                {tasks.map(task => (
                    <BacklinkTaskContainer key={task.id} task={task} projectId={project.id} />
                ))}
            </View>
        )
    } else if (listType === 'Notes') {
        return (
            <View style={localStyles.container}>
                {notes.map(item => {
                    return (
                        <DismissibleItem
                            key={item.id}
                            ref={ref => {
                                dismissibleRefs[`${item.id}`] = ref
                            }}
                            defaultComponent={
                                <NotesItem
                                    note={item}
                                    project={project}
                                    openEditModal={() => {
                                        !isSomeEditOpen() && dismissibleRefs[`${item.id}`].openModal()
                                    }}
                                />
                            }
                            modalComponent={
                                <EditNote
                                    formType={'edit'}
                                    project={project}
                                    projectId={project.id}
                                    onCancelAction={() => {
                                        dismissibleRefs[`${item.id}`]?.toggleModal()
                                    }}
                                    note={item}
                                />
                            }
                        />
                    )
                })}
            </View>
        )
    }
}

export default BacklinksList

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
})
