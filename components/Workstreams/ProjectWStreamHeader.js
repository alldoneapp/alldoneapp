import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

const ProjectWStreamHeader = ({ amount }) => {
    const parseText = number => {
        return translate(`Number Stream${number > 1 ? 's' : ''}`, { number })
    }

    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Workstreams')}</Text>
            <View style={localStyles.headerCaption}>
                <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(amount)}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
})

export default ProjectWStreamHeader
