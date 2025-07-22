import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Spinner from '../../../UIComponents/Spinner'

export default function EmptyMatch({ showSpinner, text, sppinerContainerStyle }) {
    return showSpinner ? (
        <View style={[localStyles.spinnerContainer, sppinerContainerStyle]}>
            <Spinner containerSize={48} spinnerSize={48} containerColor={colors.Secondary400} />
        </View>
    ) : (
        <View style={localStyles.container}>
            <Icon name="info" color={colors.Text04} size={32} />
            <Text style={localStyles.text}>{text}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 32,
        textAlign: 'center',
        paddingBottom: 40,
    },
    spinnerContainer: {
        paddingTop: 56,
        paddingBottom: 64.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        ...styles.title6,
        color: colors.Text04,
        marginTop: 8,
    },
})
