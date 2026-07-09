import React from 'react'
import { StyleSheet, View } from 'react-native'

import EmailLabelChip from './EmailLabelChip'
import useEmailLabelGroups from './useEmailLabelGroups'
import { getEmailLabelGroupsForProject } from './emailLineHelper'

// The email-label chip(s) for a single project, shown inline on the project's header line in
// the open-tasks views. A label maps to a project via the server-provided group.projectId (from
// the Gmail labeling config, default mode). Only labels with inbox threads are shown, matching
// the standalone Email line; renders nothing when the project has no such label.
export default function ProjectEmailLabelChips({ projectId }) {
    const { groups, labelOptionsByConnectionId, labelingDisabledByConnectionId } = useEmailLabelGroups()

    if (!projectId) return null
    const projectGroups = getEmailLabelGroupsForProject(groups, projectId)
    if (projectGroups.length === 0) return null

    return (
        <View style={localStyles.row}>
            {projectGroups.map(group => (
                <EmailLabelChip
                    key={group.key}
                    group={group}
                    labelOptionsByConnectionId={labelOptionsByConnectionId}
                    labelingDisabledByConnectionId={labelingDisabledByConnectionId}
                    style={localStyles.chip}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    // Single-line header row: drop the wrap margin and space the chip off the project name.
    chip: {
        marginLeft: 8,
        marginRight: 0,
        marginBottom: 0,
    },
})
