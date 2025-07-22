import React from 'react'
import { Keyboard } from 'react-native'
import store from '../../../../../redux/store'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_NOTE } from '../../../ConfirmPopup'
import ModalItem from '../Common/ModalItem'
import { DV_TAB_ROOT_NOTES } from '../../../../../utils/TabNavigationConstants'

export default function DeleteModalItem({ projectId, note, shortcut, onPress }) {
    const askToDelete = e => {
        e?.preventDefault()
        e?.stopPropagation()
        onPress?.()
        Keyboard.dismiss()
        store.dispatch([
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_NOTE,
                object: {
                    note,
                    projectId,
                },
            }),
            showFloatPopup(),
        ])
    }

    return <ModalItem icon={'trash-2'} text={'Delete'} shortcut={shortcut} onPress={askToDelete} />
}
