import React from 'react'
import { useSelector } from 'react-redux'

import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

export default function DoneButton({ adding, setTask, hasName, isSuggestedTask, accessGranted }) {
    const smallScreen = useSelector(state => state.smallScreen)

    const text = smallScreen
        ? null
        : translate(
              !hasName || !accessGranted
                  ? 'Ok'
                  : adding
                  ? !isSuggestedTask
                      ? 'Add'
                      : 'Assign'
                  : !adding && !hasName
                  ? `Delete`
                  : `Save`
          )

    const icon = smallScreen ? (!adding && !hasName ? 'trash-2' : !hasName ? 'x' : adding ? 'plus' : 'save') : null

    return (
        <Button
            title={text}
            type={!adding && !hasName ? 'danger' : 'primary'}
            icon={icon}
            onPress={setTask}
            accessible={false}
            shortcutText={'Enter'}
            disabled={!accessGranted}
        />
    )
}
