import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import SkillPointsWrapper from '../../SettingsView/Profile/Skills/SkillPointsWrapper/SkillPointsWrapper'

export default function Skillpoints({ projectId, disabled }) {
    const skill = useSelector(state => state.skillInDv)
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="trending-up" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Skill points')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <SkillPointsWrapper
                    skill={skill}
                    projectId={projectId}
                    points={skill.points}
                    inDetailedView={true}
                    disabled={disabled}
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
})
