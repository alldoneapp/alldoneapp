import React from 'react'

import store from '../../../../../redux/store'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_ALL_GOALS } from '../../../ConfirmPopup'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { translate } from '../../../../../i18n/TranslationService'

export default function DeleteAllGoalslItem({ projectId, shortcut, goals, onPress }) {
    const askToDelete = e => {
        e?.preventDefault()
        e?.stopPropagation()

        store.dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_ALL_GOALS,
                object: {
                    goals,
                    projectId,
                    headerText: translate('Be careful, this action is permanent'),
                    headerQuestion: translate('Do you really want to perform this action?'),
                },
            }),
        ])
        onPress()
    }

    return <ModalItem icon={'trash-2'} text={'Delete all goals'} shortcut={shortcut} onPress={askToDelete} />
}
