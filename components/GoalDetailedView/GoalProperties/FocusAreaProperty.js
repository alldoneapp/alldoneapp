import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import GoalFocusAreaTag from '../../Tags/GoalFocusAreaTag'
import { translate } from '../../../i18n/TranslationService'

export default function FocusAreaProperty({ projectId, goal, disabled, onChange, compact, dark }) {
    return (
        <View style={[localStyles.container, compact && localStyles.compact]}>
            <Icon name="tag" size={compact ? 18 : 24} color={colors.Text03} style={{ marginRight: 8 }} />
            <Text style={[localStyles.label, dark && { color: '#ffffff' }]}>{translate('Focus area')}</Text>
            <GoalFocusAreaTag
                projectId={projectId}
                goal={goal}
                disabled={disabled}
                onChange={onChange}
                showEmpty
                style={{ marginLeft: 'auto' }}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    compact: { minHeight: 40, paddingHorizontal: 16 },
    label: { ...styles.subtitle2, color: colors.Text03 },
})
