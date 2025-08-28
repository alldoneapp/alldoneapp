import React from 'react'
import { Keyboard } from 'react-native'
import store from '../../../../../redux/store'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_GOAL } from '../../../ConfirmPopup'
import ModalItem from '../Common/ModalItem'

export default function DeleteModalItem({ projectId, goal, shortcut, onPress, refKey }) {
    const askToDelete = e => {
        e?.preventDefault()
        e?.stopPropagation()
        onPress?.()
        Keyboard.dismiss()
        store.dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_GOAL,
                object: {
                    refKey,
                    goal: goal,
                    projectId,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to perform this action?',
                },
            }),
        ])
    }

    return <ModalItem icon={'trash-2'} text={'Delete'} shortcut={shortcut} onPress={askToDelete} />
}
