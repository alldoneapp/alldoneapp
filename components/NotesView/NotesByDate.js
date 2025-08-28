import React, { useEffect, useRef } from 'react'
import { View } from 'react-native'
import DateHeader from '../TaskListView/Header/DateHeader'
import AddNote from './AddNote'
import NotesItem from './NotesItem'
import DismissibleItem from '../UIComponents/DismissibleItem'
import EditNote from './EditNote'
import store from '../../redux/store'
import moment from 'moment'
import { isInputsFocused } from '../../utils/HelperFunctions'
import { isSomeEditOpen } from './NotesHelper'
import { useSelector } from 'react-redux'

// notes,
// project,
// dateString,
// date,
// firstDateSection = false,
const NotesByDate = ({ notes, project, dateString, date, firstDateSection }) => {
    const lastAddNewNoteDate = useSelector(state => state.lastAddNewNoteDate)
    const newItemRef = useRef()
    const dismissibleRefs = useRef({}).current
    const isToday = dateString === 'TODAY'

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = e => {
        if (store.getState().blockShortcuts) {
            return
        }

        const { projectId: lastPId, date: lastAddDate } = lastAddNewNoteDate
            ? lastAddNewNoteDate
            : { projectId: null, date: null }

        const shouldOpen =
            (lastAddDate == null && project.id === lastPId && date.isSame(moment(), 'day')) ||
            (lastAddDate != null && project.id === lastPId && date.isSame(moment(lastAddDate), 'day'))

        const dismissItems = document.querySelectorAll('[aria-label="dismissible-edit-item"]')
        if (e.key === '+' && dismissItems.length === 0 && !isInputsFocused() && shouldOpen) {
            e.preventDefault()
            e.stopPropagation()
            newItemRef?.current?.toggleModal()
        }
    }

    return (
        <View>
            <DateHeader isToday={isToday} dateText={dateString} date={date} firstDateSection={firstDateSection} />

            {isToday && (
                <DismissibleItem
                    ref={newItemRef}
                    defaultComponent={
                        <AddNote
                            onPress={() => {
                                !isSomeEditOpen() && newItemRef?.current?.toggleModal()
                            }}
                        />
                    }
                    modalComponent={
                        <EditNote
                            formType={'new'}
                            project={project}
                            projectId={project.id}
                            onCancelAction={() => {
                                newItemRef?.current?.toggleModal()
                            }}
                            defaultDate={date.valueOf()}
                        />
                    }
                />
            )}

            {notes &&
                notes.map(noteItem => {
                    return (
                        <DismissibleItem
                            key={noteItem.id}
                            ref={ref => {
                                dismissibleRefs[`${noteItem.id}`] = ref
                            }}
                            defaultComponent={
                                <NotesItem
                                    note={noteItem}
                                    project={project}
                                    openEditModal={() => {
                                        !isSomeEditOpen() && dismissibleRefs[`${noteItem.id}`].openModal()
                                    }}
                                />
                            }
                            modalComponent={
                                <EditNote
                                    formType={'edit'}
                                    project={project}
                                    projectId={project.id}
                                    onCancelAction={() => {
                                        dismissibleRefs[`${noteItem.id}`].toggleModal()
                                    }}
                                    note={noteItem}
                                    defaultDate={date.valueOf()}
                                />
                            }
                        />
                    )
                })}
        </View>
    )
}

export default NotesByDate
