import React from 'react'

import { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'

export default function ForwardButton({ onPress, direction, selectedCustomStep, currentStep, disabled }) {
    const text = translate(
        currentStep === OPEN_STEP ? 'Go to next step' : selectedCustomStep ? 'Send to custom step' : 'Send forward'
    )

    const handleOnPress = () => {
        setTimeout(() => onPress(direction))
    }

    return (
        <Button
            title={text}
            type={'primary'}
            disabled={disabled}
            onPress={handleOnPress}
            shortcutText={'Enter'}
            shortcutStyle={{ backgroundColor: colors.Secondary200 }}
        />
    )
}
