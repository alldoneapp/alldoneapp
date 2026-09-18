import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { groupGoalsByFocusArea } from '../../functions/shared/goalFocusAreas'

export default function FocusAreaGoals({ projectId, goals, activeDragGoalMode, children }) {
    const catalog = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.focusAreas)
    const [collapsed, setCollapsed] = useState({})
    const groups = groupGoalsByFocusArea(goals, catalog)
    if (!groups.some(group => group.id)) return children(goals, '')

    return groups.map(group => {
        const isCollapsed = !activeDragGoalMode && !!collapsed[group.id]
        return (
            <View key={group.id || 'general'} style={localStyles.group}>
                <TouchableOpacity
                    style={localStyles.heading}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !isCollapsed }}
                    disabled={!!activeDragGoalMode}
                    onPress={() => setCollapsed(previous => ({ ...previous, [group.id]: !previous[group.id] }))}
                >
                    <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.Text03} />
                    <Text style={localStyles.name}>{group.id ? group.name : translate('General')}</Text>
                    <Text style={localStyles.count}>{group.goals.length}</Text>
                </TouchableOpacity>
                {!isCollapsed && children(group.goals, group.id)}
            </View>
        )
    })
}

const localStyles = StyleSheet.create({
    group: { marginBottom: 8 },
    heading: { minHeight: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6 },
    name: { ...styles.subtitle2, color: colors.Text02, marginLeft: 8, flexShrink: 1 },
    count: { ...styles.caption2, color: colors.Text03, marginLeft: 8 },
})
