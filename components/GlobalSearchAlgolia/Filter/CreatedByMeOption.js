import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../styles/global'
import CheckBox from '../../CheckBox'
import { translate } from '../../../i18n/TranslationService'

export const CREATED_BY_ME_OPTION_LABEL = 'Only objects I created'

// Row rendered directly in the search popup, between the scope row and the
// full-search row (AT-2258 follow-up). It first shipped inside the "Select
// search scope" modal, which put it two clicks deep behind a control that looks
// like it only picks projects — and it was promptly reported as "I don't see
// any new filters in the search popup". The creator filter is an independent
// dimension from the project scope, so it gets its own always-visible row.
//
// Deliberately a single-line checkbox row matching the SearchScopeOptions rows
// stacked next to it: any difference in height, padding or alignment between
// them reads as a mistake. That is also why there is no
// explanatory hint line here — the label is self-describing, and vertical space
// in this popup belongs to the results.
export default function CreatedByMeOption({ enabled, onToggle, disabled }) {
    return (
        <TouchableOpacity
            disabled={disabled}
            style={localStyles.container}
            onPress={onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!enabled, disabled: !!disabled }}
        >
            <CheckBox
                externalContainerStyle={enabled ? { borderWidth: 1 } : { backgroundColor: 'transparent' }}
                checked={enabled}
            />
            <Text style={localStyles.text}>{translate(CREATED_BY_ME_OPTION_LABEL)}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        paddingHorizontal: 16,
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginBottom: 16,
        paddingVertical: 8,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
