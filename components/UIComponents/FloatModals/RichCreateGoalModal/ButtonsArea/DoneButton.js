import React, { useEffect } from 'react'

import Button from '../../../../UIControls/Button'

export default function DoneButton({ enterKeyAction, onPress, disabled }) {
    const onKeyDown = event => {
        const { key } = event
        if (disabled || key !== 'Enter') return
        // Holding Return down repeats the keydown event, and an IME commit
        // reports its own Enter. Neither is a second intended submission.
        if (event.repeat || event.isComposing || event.keyCode === 229) return
        enterKeyAction(event)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <Button
            icon={'plus'}
            iconColor={'#ffffff'}
            type={'primary'}
            onPress={onPress}
            shortcutText={'Enter'}
            forceShowShortcut={true}
            disabled={disabled}
        />
    )
}
