import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function AssistantAddTaskInfo({ containerStyle }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
            <Icon name={'info'} size={24} color={colors.Text03} />
            <Text style={localStyles.text}>
                {translate('Please go to open tasks to add a task for this assistant')}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 40,
        alignItems: 'center',
        paddingLeft: 4,
    },
    text: {
        marginLeft: 12,
        ...styles.body1,
        color: colors.Text03,
    },
})
