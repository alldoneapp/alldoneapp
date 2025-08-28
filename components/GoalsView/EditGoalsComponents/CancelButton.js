import React from 'react'
import { useSelector } from 'react-redux'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function CancelButton({ onCancelAction }) {
    const smallScreen = useSelector(state => state.smallScreen)
    return smallScreen ? null : (
        <Button
            title={translate('Cancel')}
            type={'secondary'}
            buttonStyle={{ marginHorizontal: 4 }}
            onPress={onCancelAction}
            shortcutText={'Esc'}
        />
    )
}
