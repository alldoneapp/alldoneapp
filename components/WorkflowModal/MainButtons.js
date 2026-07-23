import React from 'react'
import { StyleSheet, View } from 'react-native'

import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import ForwardButton from './ForwardButton'
import BackwardButton from './BackwardButton'
import { WORKFLOW_BACKWARD, WORKFLOW_FORWARD } from './workflowDirections'

export default function MainButtons({
    selectedCustomStep,
    currentStep,
    onDonePress,
    disabled,
    shortcutsEnabled = true,
}) {
    return (
        <View style={localStyles.container}>
            {currentStep !== OPEN_STEP && !selectedCustomStep && (
                <BackwardButton
                    onPress={onDonePress}
                    direction={WORKFLOW_BACKWARD}
                    disabled={disabled}
                    shortcutsEnabled={shortcutsEnabled}
                />
            )}
            <ForwardButton
                onPress={onDonePress}
                direction={WORKFLOW_FORWARD}
                selectedCustomStep={selectedCustomStep}
                currentStep={currentStep}
                disabled={disabled}
                shortcutsEnabled={shortcutsEnabled}
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
