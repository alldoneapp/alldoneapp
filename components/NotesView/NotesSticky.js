import React from 'react'
import { View } from 'react-native'
import NotesItem from './NotesItem'
import { isSomeEditOpen } from './NotesHelper'
import DismissibleItem from '../UIComponents/DismissibleItem'
import EditNote from './EditNote'

export default function NotesSticky({ fStickyNotes, inAllProjects, dismissibleRefs, project }) {
    return fStickyNotes.length > 0 && !inAllProjects ? (
        <View style={{ marginTop: 8 }}>
            {fStickyNotes.map(stickyNote => (
                <DismissibleItem
                    key={stickyNote.id}
                    ref={ref => {
                        dismissibleRefs[`${stickyNote.id}`] = ref
                    }}
                    defaultComponent={
                        <NotesItem
                            project={project}
                            note={stickyNote}
                            openEditModal={() => {
                                !isSomeEditOpen() && dismissibleRefs[`${stickyNote.id}`].openModal()
                            }}
                        />
                    }
                    modalComponent={
                        <EditNote
                            formType={'edit'}
                            project={project}
                            projectId={project.id}
                            onCancelAction={() => {
                                dismissibleRefs[`${stickyNote.id}`].toggleModal()
                            }}
                            note={stickyNote}
                        />
                    }
                />
            ))}
        </View>
    ) : null
}
