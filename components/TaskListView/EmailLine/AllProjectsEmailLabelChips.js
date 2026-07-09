import React from 'react'
import { StyleSheet, View } from 'react-native'

import EmailLabelChip from './EmailLabelChip'
import useEmailLabelGroups from './useEmailLabelGroups'
import { getUnassignedEmailLabelGroups } from './emailLineHelper'

// The email-label chips shown inline on the "All Projects" header line: the Inbox aggregate plus
// every label not tied to a project — Ads, No label, and any custom/unmapped label. Project-mapped
// labels appear on their own project line instead. Renders nothing when there are no such labels.
export default function AllProjectsEmailLabelChips() {
    const { groups, labelOptionsByConnectionId, labelingDisabledByConnectionId } = useEmailLabelGroups()

    const unassignedGroups = getUnassignedEmailLabelGroups(groups)
    if (unassignedGroups.length === 0) return null

    return (
        <View style={localStyles.row}>
            {unassignedGroups.map(group => (
                <EmailLabelChip
                    key={group.key}
                    group={group}
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
