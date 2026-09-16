import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_ARCHIVED_SCOPE_LABEL,
    ALL_PROJECTS_LABEL,
    ALL_PROJECTS_OPTION,
} from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'
import { translate } from '../../../i18n/TranslationService'

export const CREATED_BY_ME_CHIP_LABEL = 'Only created by me'
export const ARCHIVED_CHIP_LABEL = 'Include archived'
export const OPEN_TASKS_CHIP_LABEL = 'Only open tasks'

/**
 * The search popup's filter row as chips, matching the task list's
 * TaskFiltersLine pattern (individual pills; selection is the Primary200
 * background, not a checkbox). The row wraps when it runs out of room instead
 * of hiding later filters in a horizontal scroller. It replaces the three
 * stacked rows the popup used to open with — the "Select search scope" row, the
 * "Only objects I created" checkbox and the "Include archived projects"
 * checkbox — and drops the "Include templates & guides" toggle entirely:
 * template/guide projects are only searched when one is explicitly picked as
 * the scope.
 *
 * The scope chip is a PICKER (opens SelectProjectModalInSearch, alt+1). The
 * general toggles are "Only created by me" and "Include archived"; Tasks also
 * exposes "Only open tasks" while that result tab is selected.
 *
 * "Include archived" is back (AT-2524) after AT-2390 removed it, and the two
 * archived controls no longer overlap because they answer DIFFERENT questions:
 * the chip widens the "All projects" group scope to active **and** archived,
 * while the picker's "All archived" scope searches archived **only**. That
 * distinction is what AT-2390 could not express — it accepted "active and
 * archived can no longer be searched together in one query" as a cost, and this
 * is the task that decided the cost was too high. The chip is therefore ON by
 * default: a user searching their whole workspace expects to find what they
 * archived, and having to know about a picker to reach it is the discoverability
 * problem AT-2258 already hit once.
 *
 * The chip only ever ADDS archived projects to a group scope. It is hidden —
 * not merely inert — whenever it could not mean anything: with one specific
 * project as the scope (a picked project is always searched, archived or not)
 * and for a user with no archived projects at all. `showArchivedChip` is
 * resolved by the modal, which owns both facts.
 */
export default function SearchFilterChips({
    selectedProject,
    onOpenScope,
    createdByMeOnly,
    onToggleCreatedByMe,
    includeArchived,
    onToggleArchived,
    showArchivedChip,
    openTasksOnly,
    onToggleOpenTasks,
    showOpenTasksChip,
    disabled,
    mobile,
    compact,
}) {
    return (
        <View
            testID="global-search-filters"
            style={[
                localStyles.container,
                mobile && localStyles.mobileContainer,
                compact && localStyles.compactContainer,
            ]}
        >
            <View testID="global-search-filter-chip-row" style={localStyles.chipsRow}>
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
                {showOpenTasksChip && (
                    <ToggleChip
                        label={OPEN_TASKS_CHIP_LABEL}
                        selected={openTasksOnly}
                        onPress={onToggleOpenTasks}
                        disabled={disabled}
                        testID={'search-filter-open-tasks'}
                    />
                )}
            </View>
        </View>
    )
}

// The two group scopes the picker offers (AT-2390). Kept as one table so the
// chip and the picker's leading rows cannot drift apart.
export const GROUP_SCOPE_LABELS = {
    [ALL_PROJECTS_OPTION]: ALL_PROJECTS_LABEL,
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
    mobileContainer: {
        marginTop: 12,
        marginBottom: 12,
    },
    compactContainer: {
        marginTop: 8,
        marginBottom: 8,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        // Each chip owns an 8px right/bottom gutter. Cancel the trailing
        // gutter so wrapping is based on the full padded content width and the
        // divider below keeps the same optical spacing on one or many rows.
        marginRight: -8,
        marginBottom: -8,
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
        marginBottom: 8,
        minHeight: 24,
        flexShrink: 0,
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
