import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Indicator from '../Indicator'
import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'

export default function NoteTitlePresentation({ openTitleEdition, note, projectId, disabled = false }) {
    const { extendedTitle } = note
    return (
        <TouchableOpacity style={localStyles.container} onPress={openTitleEdition} disabled={disabled}>
            <View style={localStyles.titleContainer}>
                <CommentElementsParser
                    comment={extendedTitle}
                    entryStyle={localStyles.text}
                    projectId={projectId}
                    elementSpace={{ marginRight: 4 }}
                    inDetaliedView={true}
                />
            </View>
            <Indicator />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flex: 1,
        marginTop: 32,
    },
    text: {
        ...styles.title4,
        color: colors.Text01,
    },
    titleContainer: {
        flex: 1,
    },
})
