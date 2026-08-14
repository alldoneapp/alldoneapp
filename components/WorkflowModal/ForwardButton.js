import React from 'react'
import { StyleSheet } from 'react-native'

import { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'

export default function ForwardButton({
    onPress,
    direction,
    selectedCustomStep,
    currentStep,
    disabled,
    shortcutsEnabled = true,
    buttonStyle,
    targetStepName,
}) {
    const text = translate(
        currentStep === OPEN_STEP ? 'Go to next step' : selectedCustomStep ? 'Send to custom step' : 'Send forward'
    )

    const handleOnPress = () => {
        setTimeout(() => onPress(direction))
    }

    return (
        <Button
            title={text}
            subtitle={targetStepName}
            type={'primary'}
            disabled={disabled}
            onPress={handleOnPress}
            shortcutText={shortcutsEnabled ? 'Enter' : undefined}
            shortcutStyle={{ backgroundColor: colors.Secondary200 }}
            buttonStyle={[targetStepName && localStyles.withTargetStep, buttonStyle]}
        />
    )
}

const localStyles = StyleSheet.create({
    withTargetStep: {
        height: 52,
        maxHeight: 52,
        minHeight: 52,
        paddingVertical: 5,
    },
})
