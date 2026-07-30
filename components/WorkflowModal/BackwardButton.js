import React from 'react'
import Hotkeys from 'react-hot-keys'

import { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'

export default function BackwardButton({ disabled, onPress, direction, shortcutsEnabled = true, buttonStyle }) {
    const handleOnPress = () => {
        setTimeout(() => onPress(direction))
    }

    const button = (
        <Button
            title={translate('Send back')}
            type={'secondary'}
            disabled={disabled}
            onPress={handleOnPress}
            shortcutText={shortcutsEnabled ? 'X' : undefined}
            shortcutStyle={{ backgroundColor: colors.Secondary200 }}
            buttonStyle={[{ marginRight: 8 }, buttonStyle]}
        />
    )

    return shortcutsEnabled ? (
        <Hotkeys keyName={'alt+x'} onKeyDown={handleOnPress} filter={e => true}>
            {button}
        </Hotkeys>
    ) : (
        button
    )
}
