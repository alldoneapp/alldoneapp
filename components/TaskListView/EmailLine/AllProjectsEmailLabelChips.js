import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

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
            {visibleGroups.map(group => (
                <EmailLabelChip
                    key={group.key}
                    group={group}
                    allGroups={groups}
                    labelOptionsByConnectionId={labelOptionsByConnectionId}
                    labelingDisabledByConnectionId={labelingDisabledByConnectionId}
                    compact
                    style={localStyles.chip}
                />
            ))}
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
    chip: {
        marginLeft: 8,
        marginRight: 0,
        marginBottom: 0,
    },
})
