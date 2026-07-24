import React, { useEffect } from 'react'

import Button from '../../../UIControls/Button'

export default function DoneButton({ enterKeyAction, done, disabled }) {
    const onKeyDown = event => {
        const { key } = event
        if (!disabled && key === 'Enter') enterKeyAction(event)
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
            onPress={done}
            shortcutText={'Enter'}
            forceShowShortcut={true}
            disabled={disabled}
        />
    )
}
