import React from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { getSkillRuntimeLabelKey } from './assistantSkillsHelper'

export default function AssistantSkillItem({ skill, onPress }) {
    const isImported = skill.source?.type === 'import'
    const shortSha = isImported && skill.source?.sha ? skill.source.sha.slice(0, 7) : ''
    const repoLabel = isImported ? (skill.source?.repoUrl || '').replace('https://github.com/', '') : ''

    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Icon name={'zap'} size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <View style={localStyles.titleRow}>
                    <Text style={[styles.subtitle1, { color: colors.Text01 }]} numberOfLines={1}>
                        {skill.displayName || skill.name}
                    </Text>
                    <Text style={[styles.caption2, localStyles.slug]} numberOfLines={1}>
                        {skill.name}
                    </Text>
                </View>
                <Text style={[styles.caption2, { color: colors.Text03 }]} numberOfLines={1}>
                    {skill.description}
                </Text>
            </View>
            <View style={localStyles.badges}>
                {skill.enabled === false && (
                    <View style={[localStyles.badge, localStyles.badgeDisabled]}>
                        <Text style={[styles.caption2, { color: colors.Text03 }]}>{translate('Disabled')}</Text>
                    </View>
                )}
                <View style={localStyles.badge}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>
                        {translate(getSkillRuntimeLabelKey(skill))}
                    </Text>
                </View>
                {isImported && (
                    <View style={localStyles.badge}>
                        <Text style={[styles.caption2, { color: colors.Text02 }]} numberOfLines={1}>
                            {repoLabel}
                            {shortSha ? ` @ ${shortSha}` : ''}
                        </Text>
                    </View>
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    icon: {
        marginRight: 12,
    },
    textContainer: {
        flexShrink: 1,
        flexGrow: 1,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    slug: {
        color: colors.Text03,
        marginLeft: 8,
    },
    badges: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
    },
    badge: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginLeft: 6,
        maxWidth: 220,
    },
    badgeDisabled: {
        backgroundColor: colors.Grey200,
    },
})
