import React from 'react'
import { useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'
import Spinner from './Spinner'

export default function LoadingNoteData() {
    const isLoadingNoteData = useSelector(state => state.isLoadingNoteData)
    const noteEditorScrollDimensions = useSelector(state => state.noteEditorScrollDimensions)

    const { width, height } = noteEditorScrollDimensions
    const bottom = height * 0.5 - 48
    const right = width * 0.5 - 48
    return (
        isLoadingNoteData &&
        width !== 0 &&
        height !== 0 && (
            <View style={[localStyles.container, { bottom, right }]}>
                <Spinner containerSize={96} spinnerSize={72} />
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
    },
})
