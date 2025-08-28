import React from 'react'
import { StyleSheet, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import DescriptionWrapper from './DescriptionWrapper'
import AssistantData from './AssistantData'

export default function AssistantDataProperty({ projectId, assistant, disabled }) {
    return (
        <View style={localStyles.container}>
            <AssistantData disabled={disabled} projectId={projectId} assistant={assistant} />
            <View style={{ marginLeft: 'auto' }}>
                <DescriptionWrapper projectId={projectId} assistant={assistant} disabled={disabled} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    button: {
        marginHorizontal: 0,
    },
})
