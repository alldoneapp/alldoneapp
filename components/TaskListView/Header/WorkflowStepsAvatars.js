import React from 'react'
import { StyleSheet, View } from 'react-native'
import Line from '../../Line'
import Avatar from '../../Avatar'
import { chronoEntriesOrder } from '../../../utils/HelperFunctions'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

export default function WorkflowStepsAvatars({ projectId, currentStepId, assignee }) {
    const projectWorkflow = assignee.workflow[projectId]
    const steps = Object.entries(projectWorkflow).sort(chronoEntriesOrder)

    return (
        <View style={localStyles.centeredRow}>
            {steps.map(step => {
                const stepId = step[0]
                const highlight = stepId === currentStepId
                return (
                    <View key={stepId} style={localStyles.centeredRow}>
                        <Line />
                        <Avatar
                            highlight={highlight}
                            reviewerPhotoURL={getUserPresentationData(step[1].reviewerUid).photoURL}
                            size={highlight ? 22 : 20}
                            borderSize={highlight ? 3 : 2}
                        />
                    </View>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    centeredRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
