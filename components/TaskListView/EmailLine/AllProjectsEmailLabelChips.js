import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import EmailLabelChip from './EmailLabelChip'
import useEmailLabelGroups from './useEmailLabelGroups'
import { getProjectLineEmailChipLimit, getUnassignedEmailLabelGroups } from './emailLineHelper'

// The email-label chips shown inline on the "All Projects" header line: the Inbox aggregate plus
// every label not tied to a project — Ads, No label, and any custom/unmapped label. Project-mapped
// labels appear on their own project line instead. Renders nothing when there are no such labels.
export default function AllProjectsEmailLabelChips() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const { groups, labelOptionsByConnectionId, labelingDisabledByConnectionId } = useEmailLabelGroups()

    const unassignedGroups = getUnassignedEmailLabelGroups(groups)
    const groupsForLayout = mobile ? unassignedGroups.filter(group => group.isInbox) : unassignedGroups
    const visibleGroups = groupsForLayout.slice(0, getProjectLineEmailChipLimit(mobile, tablet))
    if (visibleGroups.length === 0) return null

    return (
        <View style={localStyles.row}>
            <View style={localStyles.group}>
                {visibleGroups.map((group, index) => (
                    <EmailLabelChip
                        key={group.key}
                        group={group}
                        allGroups={groups}
                        labelOptionsByConnectionId={labelOptionsByConnectionId}
                        labelingDisabledByConnectionId={labelingDisabledByConnectionId}
                        compact
                        showIcon={index === 0}
                        style={localStyles.chip}
                    />
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 1,
        minWidth: 0,
    },
    group: {
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.Text03,
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 8,
    },
    chip: {
        borderWidth: 0,
        borderRadius: 0,
        flexShrink: 1,
        minWidth: 0,
        marginLeft: 0,
        marginRight: 0,
        marginBottom: 0,
    },
})
