import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import SkillCompletionWrapper from '../../SettingsView/Profile/Skills/SkillCompletionWrapper/SkillCompletionWrapper'

export default function CompletionProperty({ skill, projectId, disabled }) {
    return (
        <View style={localStyles.container}>
            <Icon name="bar-chart-2-Horizontal" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Completion')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <SkillCompletionWrapper
                    disabled={disabled}
                    skill={skill}
                    projectId={projectId}
                    buttonStyle={localStyles.button}
                    inDv={true}
                />
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
