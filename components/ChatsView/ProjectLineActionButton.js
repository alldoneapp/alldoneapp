import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import global, { colors } from '../styles/global'
import { taskHierarchyStyles } from '../TaskListView/TaskHierarchy'

/**
 * The neutral button used by the bulk actions that sit on the right of a project line ("Archive
 * emails", "mark as read") - the All Projects line and every per-project line.
 *
 * Both buttons rendered their label unconditionally, with `flexShrink: 0` on the text, while the
 * row itself is `justifyContent: 'space-between'` with a shrinkable title on the left. On a phone
 * the two labels ("Archive all emails" + "mark all as read") are wider than the whole row, so the
 * actions container was squeezed while its text refused to shrink - the labels overflowed their
 * own container and drew straight over the project title (AT-2263).
 *
 * On `smallScreenNavigation` the button therefore drops its label and keeps just the icon, which is
 * what the neighbours on the very same row already do (`AddTaskTag`, `EmailLabelChip`). The wording
 * survives as the accessible name through `accessibilityLabel`, which react-native-web maps to a
 * real `aria-label` attribute.
 *
 * Deliberately NOT a `title` tooltip: react-native-web >= 0.19 renders only an allowlist of props
 * (`modules/forwardedProps`), and `title` is not on it - `pickProps` drops it before the DOM node is
 * created, so `title={...}` on a Touchable/View is dead code today. (`TagsArea`'s Workflow chip and
 * `CopyLinkButton`'s `data-tip` are both in that state; worth a separate cleanup.) The visible
 * affordance on a touch screen is the icon itself, matching every other icon-only control on the row.
 */
export default function ProjectLineActionButton({
    icon,
    label,
    accessibilityLabel,
    loading = false,
    error = false,
    disabled = false,
    onPress,
    containerStyle,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity
            accessibilityLabel={accessibilityLabel || label}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled }}
            style={[
                localStyles.container,
                taskHierarchyStyles.headerSecondaryButton,
                mobile && taskHierarchyStyles.headerAddButtonMobile,
                mobile && localStyles.containerIconOnly,
                disabled && localStyles.disabled,
                error && localStyles.errorContainer,
                containerStyle,
            ]}
            onPress={onPress}
            disabled={disabled}
        >
            {loading ? (
                <ActivityIndicator size="small" color={colors.Text02} />
            ) : (
                <Icon name={icon} size={16} color={error ? colors.UtilityRed200 : colors.Text02} />
            )}
            {!mobile && (
                <Text style={[localStyles.text, error && localStyles.errorText]} numberOfLines={1}>
                    {label}
                </Text>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 0,
        // The row's left side is the part that gives way: these actions keep their intrinsic
        // width so a long project name truncates instead of the buttons being squashed.
        flexShrink: 0,
    },
    containerIconOnly: {
        justifyContent: 'center',
        paddingLeft: 0,
        paddingRight: 0,
    },
    text: {
        ...global.caption1,
        color: colors.Text02,
        marginLeft: 6,
        flexShrink: 0,
    },
    disabled: {
        opacity: 0.6,
    },
    errorContainer: {
        borderWidth: 1,
        borderColor: colors.UtilityRed200,
    },
    errorText: {
        color: colors.UtilityRed200,
    },
})
