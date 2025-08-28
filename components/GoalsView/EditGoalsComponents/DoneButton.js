import React from 'react'
import { useSelector } from 'react-redux'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function DoneButton({ needUpdate, adding, actionDoneButton, disabled = false }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const title = smallScreen ? null : needUpdate ? translate(adding ? 'Add' : 'Save') : 'Ok'
    const icon = smallScreen ? (needUpdate ? (adding ? 'plus' : 'save') : 'x') : null
    return (
        <Button
            title={title}
            type={'primary'}
            icon={icon}
            onPress={actionDoneButton}
            shortcutText={'Enter'}
            disabled={disabled}
        />
    )
}
