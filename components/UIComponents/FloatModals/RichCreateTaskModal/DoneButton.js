import React from 'react'

import Button from '../../../UIControls/Button'

export default function DoneButton({ done, disabled }) {
    // Enter is handled once, by TaskEditForm's document listener. This button
    // used to register a third identical listener for the same key, which made
    // one Return press run the creation several times.
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
