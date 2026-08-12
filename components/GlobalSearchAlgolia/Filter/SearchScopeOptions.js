import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import CheckBox from '../../CheckBox'
import { translate } from '../../../i18n/TranslationService'

export const INCLUDE_ARCHIVED_OPTION_LABEL = 'Include archived projects'
export const INCLUDE_TEMPLATES_GUIDES_OPTION_LABEL = 'Include templates & guides'

// Search scope toggles (TYPESENSE_MIGRATION.md Phase 3). Archived and template/guide
// projects used to be absent from search results because their records did not exist in
// Algolia — index absence did the hiding. Typesense indexes everything, so exclusion is
// now an explicit, user-controllable choice: both toggles default OFF, and an
// all-projects search covers only active projects until the user widens it. Picking a
// specific archived/template/guide project in the scope row always searches it, which is
// why the whole block is hidden while a single project is selected.
//
// Rows deliberately mirror CreatedByMeOption's single-line checkbox row — the three sit
// stacked, and any difference in height, padding or alignment reads as a mistake.
const ScopeToggleRow = ({ label, enabled, onToggle, disabled }) => (
    <TouchableOpacity
        disabled={disabled}
        style={localStyles.row}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!enabled, disabled: !!disabled }}
    >
        <CheckBox
            externalContainerStyle={enabled ? { borderWidth: 1 } : { backgroundColor: 'transparent' }}
            checked={enabled}
        />
        <Text style={localStyles.text}>{translate(label)}</Text>
    </TouchableOpacity>
)

export default function SearchScopeOptions({
    includeArchived,
    includeTemplatesAndGuides,
    onToggleArchived,
    onToggleTemplatesAndGuides,
    disabled,
}) {
    return (
        <View>
            <ScopeToggleRow
                label={INCLUDE_ARCHIVED_OPTION_LABEL}
                enabled={includeArchived}
                onToggle={onToggleArchived}
                disabled={disabled}
            />
            <ScopeToggleRow
                label={INCLUDE_TEMPLATES_GUIDES_OPTION_LABEL}
                enabled={includeTemplatesAndGuides}
                onToggle={onToggleTemplatesAndGuides}
                disabled={disabled}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
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
