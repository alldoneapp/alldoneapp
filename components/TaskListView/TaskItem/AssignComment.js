import React from 'react'
import { useSelector } from 'react-redux'

import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function AssignComment({ setTask, disabled, buttonItemStyle }) {
    const smallScreen = useSelector(state => state.smallScreen)

    const onSuggest = e => {
        setTask(e, false, false, true)
    }

    return (
        <Button
            title={!smallScreen ? translate('Assign & Comment') : ''}
            icon={smallScreen ? 'add-message-circle' : null}
            type="secondary"
            buttonStyle={buttonItemStyle}
            disabled={disabled}
            onPress={onSuggest}
        />
    )
}
