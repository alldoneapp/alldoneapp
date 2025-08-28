import React from 'react'
import { StyleSheet, View } from 'react-native'
import DeleteNoteButton from './DeleteNoteButton'

const DeleteNote = ({ projectId, note }) => {
    return (
        <View style={localStyles.container}>
            <View style={{ marginLeft: 'auto' }}>
                <DeleteNoteButton projectId={projectId} note={note} />
            </View>
        </View>
    )
}
export default DeleteNote

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 11,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
