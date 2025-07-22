import React from 'react'
import Hotkeys from 'react-hot-keys'

import { colors } from '../styles/global'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'

export default function BackwardButton({ disabled, onPress, direction }) {
    const handleOnPress = () => {
        setTimeout(() => onPress(direction))
    }

    return (
        <Hotkeys keyName={'alt+x'} onKeyDown={handleOnPress} filter={e => true}>
            <Button
                title={translate('Send back')}
                type={'secondary'}
                disabled={disabled}
                onPress={handleOnPress}
                shortcutText={'X'}
                shortcutStyle={{ backgroundColor: colors.Secondary200 }}
                buttonStyle={{ marginRight: 8 }}
            />
        </Hotkeys>
    )
}
