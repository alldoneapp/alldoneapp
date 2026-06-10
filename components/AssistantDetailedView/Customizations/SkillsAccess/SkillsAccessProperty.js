import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import SkillsAccessWrapper from './SkillsAccessWrapper'
import { normalizeEnabledSkillIds } from '../../../AdminPanel/AssistantSkills/assistantSkillsHelper'
import { getGlobalAssistantSkills } from '../../../../utils/backends/AssistantSkills/assistantSkillsFirestore'

export default function SkillsAccessProperty({ disabled, projectId, assistant }) {
    const [skillNamesById, setSkillNamesById] = useState({})
    const enabledSkillIds = normalizeEnabledSkillIds(assistant.enabledSkillIds)

    useEffect(() => {
        let mounted = true
        getGlobalAssistantSkills().then(skills => {
            if (!mounted) return
            const namesById = {}
            skills.forEach(skill => {
                namesById[skill.uid] = skill.displayName || skill.name
            })
            setSkillNamesById(namesById)
        })
        return () => {
            mounted = false
        }
    }, [])

    const enabledNames = enabledSkillIds.map(skillId => skillNamesById[skillId]).filter(Boolean)
    const summaryText = enabledNames.length === 0 ? translate('No skills enabled') : enabledNames.join(', ')

    return (
        <View style={localStyles.container}>
            <Icon name="zap" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('Enabled skills')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <SkillsAccessWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
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
    textContainer: {
        flexShrink: 1,
        flexGrow: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    summary: {
        ...styles.caption2,
        color: colors.Text04,
    },
})
