import React from 'react'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'

export default function OpenInNewWindowModalItem({ onPress, shortcut }) {
    const openUrl = () => {
        window.open(window.location, '_blank')
        onPress?.()
    }

    return (
        <ModalItem
            icon={'new-window'}
            text={'Open view in new window'}
            shortcut={shortcut}
            onPress={openUrl}
        />
    )
}
