import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../styles/global'
import ChangeNextStep from './ChangeNextStep'
import WorkflowStepTag from './WorkflowStepTag'

export default function NextStep({
    selectedNextStep,
    selectedCustomStep,
    currentStep,
    nextStepDescription,
    nextStepPhotoURL,
    openWorkFlowSelection,
}) {
    return (
        <View style={localStyles.container}>
            <ChangeNextStep currentStep={currentStep} openWorkFlowSelection={openWorkFlowSelection} />
            {selectedCustomStep && (
                <WorkflowStepTag
                    containerStyle={{ marginTop: 10, alignSelf: 'flex-start' }}
                    stepDescription={nextStepDescription}
                    reviewerPhoto={nextStepPhotoURL}
                    step={selectedNextStep}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
})
