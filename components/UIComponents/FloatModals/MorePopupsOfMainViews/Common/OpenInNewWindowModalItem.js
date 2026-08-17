import React from 'react'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { openViewInNewWindow } from '../../../../../utils/openInNewWindow'

export default function OpenInNewWindowModalItem({ onPress, shortcut }) {
    // Inside an installed desktop PWA a plain window.open would spawn a second app window
    // instead of a browser tab — see utils/openInNewWindow.js (AT-2345).
    const openUrl = () => {
        openViewInNewWindow()
        onPress?.()
    }

    return <ModalItem icon={'new-window'} text={'Open view in new window'} shortcut={shortcut} onPress={openUrl} />
}
