import React from 'react'
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import {
    ALL_ACTIVE_SCOPE_LABEL,
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_ARCHIVED_SCOPE_LABEL,
    ALL_PROJECTS_OPTION,
} from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'
import { translate } from '../../../i18n/TranslationService'

export const CREATED_BY_ME_CHIP_LABEL = 'Created by me'
export const ARCHIVED_CHIP_LABEL = 'Archived'

/**
 * The search popup's filter row as chips, matching the task list's
 * TaskFiltersLine pattern (one horizontal row of pills; selection is the
 * Primary200 background, not a checkbox). Replaces the three stacked rows the
 * popup used to open with — the "Select search scope" row, the
 * "Only objects I created" checkbox and the "Include archived projects"
 * checkbox — and drops the "Include templates & guides" toggle entirely:
 * template/guide projects are only searched when one is explicitly picked as
 * the scope.
 *
 * The scope chip is a PICKER (opens SelectProjectModalInSearch, alt+1), the
 * other chips are toggles. The archived chip hides while a specific project
 * is the scope, exactly like the toggle rows it replaces — a picked project
 * is always searched, archived or not.
 */
export default function SearchFilterChips({
    selectedProject,
    onOpenScope,
    createdByMeOnly,
    onToggleCreatedByMe,
    includeArchived,
    onToggleArchived,
    showArchivedChip,
    disabled,
}) {
    return (
        <View style={localStyles.container}>
            <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={localStyles.chipsRow}
            >
                <ScopeChip selectedProject={selectedProject} onPress={onOpenScope} disabled={disabled} />
                <ToggleChip
                    label={CREATED_BY_ME_CHIP_LABEL}
                    selected={createdByMeOnly}
                    onPress={onToggleCreatedByMe}
                    disabled={disabled}
                    testID={'search-filter-created-by-me'}
                />
                {showArchivedChip && (
                    <ToggleChip
                        label={ARCHIVED_CHIP_LABEL}
                        selected={includeArchived}
                        onPress={onToggleArchived}
                        disabled={disabled}
                        testID={'search-filter-archived'}
                    />
                )}
            </ScrollView>
        </View>
    )
}

// The two group scopes the picker offers (AT-2390). Kept as one table so the
// chip, the picker's leading rows and the i18n keys cannot drift apart.
export const GROUP_SCOPE_LABELS = {
    [ALL_PROJECTS_OPTION]: ALL_ACTIVE_SCOPE_LABEL,
    [ALL_ARCHIVED_PROJECTS_OPTION]: ALL_ARCHIVED_SCOPE_LABEL,
}

export function ScopeChip({ selectedProject, onPress, disabled }) {
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const groupScopeLabel = GROUP_SCOPE_LABELS[selectedProject.id]
    const project = groupScopeLabel ? null : selectedProject
    const label = shrinkTagText(project ? project.name : translate(groupScopeLabel), smallScreenNavigation ? 15 : 25)

    return (
        <TouchableOpacity
            disabled={disabled}
            style={localStyles.chip}
            onPress={onPress}
            testID={'search-filter-scope'}
            accessibilityLabel={translate('Select search scope')}
        >
            {project ? (
                <ColoredCircleSmall
                    size={12}
                    color={project.color}
                    isGuide={!!project.parentTemplateId}
                    containerStyle={localStyles.chipLeading}
                    projectId={project.id}
                />
            ) : selectedProject.id === ALL_ARCHIVED_PROJECTS_OPTION ? (
                <Icon name="archive" size={12} color={colors.Text03} style={localStyles.chipLeading} />
            ) : (
                <Image style={[localStyles.avatar, localStyles.chipLeading]} source={{ uri: photoURL }} />
            )}
            <Text style={localStyles.chipText}>{label}</Text>
            <Icon name="chevron-down" size={12} color={colors.Text03} style={localStyles.chipChevron} />
            <Hotkeys keyName={'alt+1'} onKeyDown={onPress} filter={e => true} />
        </TouchableOpacity>
    )
}

export function ToggleChip({ label, selected, onPress, disabled, testID }) {
    return (
        <TouchableOpacity
            disabled={disabled}
            style={[localStyles.chip, selected && localStyles.chipSelected]}
            onPress={onPress}
            testID={testID}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!selected, disabled: !!disabled }}
        >
            <Text style={[localStyles.chipText, selected && localStyles.chipTextSelected]}>{translate(label)}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        marginTop: 16,
        marginBottom: 16,
        paddingHorizontal: 16,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        alignItems: 'center',
    },
    // Same pill as the task list's FilterChip (TaskFiltersLine.js): selection
    // is the background color, not a checkbox.
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        minHeight: 24,
    },
    chipSelected: {
        backgroundColor: colors.Primary200,
    },
    chipLeading: {
        marginRight: 6,
    },
    chipText: {
        ...styles.caption1,
        color: colors.Text03,
    },
    chipTextSelected: {
        color: 'white',
    },
    chipChevron: {
        marginLeft: 4,
    },
    avatar: {
        width: 14,
        height: 14,
        borderRadius: 100,
    },
})
