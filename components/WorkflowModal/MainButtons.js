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
    compact = false,
}) {
    return (
        <View testID="workflow-main-buttons" style={[localStyles.container, compact && localStyles.compactContainer]}>
            {currentStep !== OPEN_STEP && !selectedCustomStep && (
                <BackwardButton
                    onPress={onDonePress}
                    direction={WORKFLOW_BACKWARD}
                    disabled={disabled}
                    shortcutsEnabled={shortcutsEnabled}
                    buttonStyle={compact && localStyles.compactBackwardButton}
                />
            )}
            <ForwardButton
                onPress={onDonePress}
                direction={WORKFLOW_FORWARD}
                selectedCustomStep={selectedCustomStep}
                currentStep={currentStep}
                disabled={disabled}
                shortcutsEnabled={shortcutsEnabled}
                buttonStyle={compact && localStyles.compactButton}
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
    compactContainer: {
        flex: 1,
        height: 'auto',
        paddingTop: 0,
        paddingBottom: 0,
    },
    compactButton: {
        alignSelf: 'stretch',
        flex: 1,
        paddingLeft: 8,
        paddingRight: 8,
    },
    compactBackwardButton: {
        alignSelf: 'stretch',
        flex: 1,
        marginRight: 8,
        paddingLeft: 8,
        paddingRight: 8,
    },
})
