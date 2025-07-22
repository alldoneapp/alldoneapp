import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import {
    hideFloatPopup,
    setSearchText,
    setShowCheatSheet,
    showFloatPopup,
    showGlobalSearchPopup,
} from '../../../redux/actions'
import { dismissAllPopups, shortcutPreviewMount, shortcutPreviewUnmount } from '../../../utils/HelperFunctions'

export default function CheatSheet() {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showCheatSheet = useSelector(state => state.showCheatSheet)

    const onShortcutPress = (s, event) => {
        event.preventDefault()
        if (blockShortcuts) {
            return
        }

        if (
            (s === 'alt+?' || s === 'alt+/' || s === 'alt+shift+?' || s === 'alt+shift+/') &&
            !showCheatSheet &&
            !smallScreenNavigation
        ) {
            dismissAllPopups()
            dispatch([setShowCheatSheet(true), showFloatPopup()])
        } else if (s === 'alt+f') {
            if (!isAnonymous) {
                dispatch([hideFloatPopup(), setSearchText(''), showGlobalSearchPopup(true)])
                dismissAllPopups()
            }
        }
    }

    useEffect(() => {
        shortcutPreviewMount()
        return () => {
            shortcutPreviewUnmount()
        }
    }, [])

    return (
        <Hotkeys keyName={'alt+?,alt+/,alt+shift+?,alt+shift+/,alt+f'} onKeyDown={onShortcutPress} filter={e => true} />
    )
}
