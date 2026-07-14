import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import EmailLabelChip from './EmailLabelChip'
import useEmailLabelGroups from './useEmailLabelGroups'
import { getEmailLabelGroupsForProject, getProjectLineEmailChipLimit } from './emailLineHelper'

// The email-label chip(s) for a single project, shown inline on the project's header line in
// the open-tasks views. A label maps to a project via the server-provided group.projectId (from
// the Gmail labeling config, default mode). Only labels with inbox threads are shown, matching
// the standalone Email line; renders nothing when the project has no such label.
export default function ProjectEmailLabelChips({ projectId }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const { groups, labelOptionsByConnectionId, labelingDisabledByConnectionId } = useEmailLabelGroups()

    if (!projectId) return null
    const projectGroups = getEmailLabelGroupsForProject(groups, projectId)
    const visibleGroups = projectGroups.slice(0, getProjectLineEmailChipLimit(mobile, tablet))
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
        marginLeft: 8,
        marginRight: 8,
    },
    // Single-line header row: drop the wrap margin so the pill matches the other header tags.
    chip: {
        marginLeft: 0,
        marginRight: 0,
        marginBottom: 0,
    },
})
