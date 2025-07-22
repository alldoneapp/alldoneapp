import React from 'react'
import { StyleSheet, View } from 'react-native'

import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import ForwardButton from './ForwardButton'
import BackwardButton from './BackwardButton'
import { WORKFLOW_BACKWARD, WORKFLOW_FORWARD } from './WorkflowModal'

export default function MainButtons({ selectedCustomStep, currentStep, onDonePress, disabled }) {
    return (
        <View style={localStyles.container}>
            {currentStep !== OPEN_STEP && !selectedCustomStep && (
                <BackwardButton onPress={onDonePress} direction={WORKFLOW_BACKWARD} disabled={disabled} />
            )}
            <ForwardButton
                onPress={onDonePress}
                direction={WORKFLOW_FORWARD}
                selectedCustomStep={selectedCustomStep}
                currentStep={currentStep}
                disabled={disabled}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
        paddingBottom: 16,
    },
})
