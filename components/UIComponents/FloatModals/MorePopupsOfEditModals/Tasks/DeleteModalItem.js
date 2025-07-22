import React from 'react'
import { Keyboard } from 'react-native'
import store from '../../../../../redux/store'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../../../ConfirmPopup'
import ModalItem from '../Common/ModalItem'

export default function DeleteModalItem({ projectId, task, shortcut, onPress }) {
    const askToDeleteTask = e => {
        if (e) e.preventDefault()
        onPress?.()
        Keyboard.dismiss()
        store.dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: { task: task, projectId: projectId, originalTaskName: task.name },
            }),
        ])
    }

    return <ModalItem icon={'trash-2'} text={'Delete'} shortcut={shortcut} onPress={askToDeleteTask} />
}
