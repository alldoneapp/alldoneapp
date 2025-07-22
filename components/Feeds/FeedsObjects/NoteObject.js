import React from 'react'
import { View } from 'react-native'

import NoteObjectHeader from './NoteObjectHeader'
import NoteObjectBody from './NoteObjectBody'

export default function NoteObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const { object, feeds } = feedObjectData
    const { noteId, lastChangeDate } = object
    const { type: viewType } = feedViewData
    return (
        <View style={style}>
            {viewType !== 'note' && <NoteObjectHeader feed={object} projectId={projectId} />}
            <NoteObjectBody
                feeds={feeds}
                noteId={noteId}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}
