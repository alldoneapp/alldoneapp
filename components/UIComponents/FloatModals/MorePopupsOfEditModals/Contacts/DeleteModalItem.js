import React from 'react'
import { Keyboard } from 'react-native'
import store from '../../../../../redux/store'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'
import {
    CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT,
    CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
} from '../../../ConfirmPopup'
import ModalItem from '../Common/ModalItem'

export default function DeleteModalItem({ projectId, contact, isMember, shortcut, onPress }) {
    const askToDelete = e => {
        if (e) e.preventDefault()
        onPress?.()
        Keyboard.dismiss()

        if (isMember) {
            store.dispatch([
                showFloatPopup(),
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT,
                    object: {
                        userId: contact.uid,
                        projectId: projectId,
                    },
                }),
            ])
        } else {
            store.dispatch([
                showFloatPopup(),
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_DELETE_PROJECT_CONTACT,
                    object: {
                        projectId: projectId,
                        contactId: contact.uid,
                        contact: contact,
                        headerText: 'Be careful, this action is permanent',
                        headerQuestion: 'Do you really want to delete this contact?',
                    },
                }),
            ])
        }
    }

    return (
        <ModalItem
            icon={isMember ? 'kick' : 'trash-2'}
            text={isMember ? 'Kick out' : 'Delete'}
            shortcut={shortcut}
            onPress={askToDelete}
        />
    )
}
