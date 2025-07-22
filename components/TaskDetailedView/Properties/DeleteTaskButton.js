import React from 'react'

import { colors } from '../../styles/global'
import store from '../../../redux/store'
import { showConfirmPopup } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../../UIComponents/ConfirmPopup'
import Button from '../../UIControls/Button'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { translate } from '../../../i18n/TranslationService'

export default function DeleteTaskButton({ task, projectId }) {
    const onPress = () => {
        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: {
                    task: task,
                    projectId: projectId,
                    navigation: DV_TAB_ROOT_TASKS,
                    originalTaskName: task.name,
                },
            })
        )
    }

    return (
        <Button
            icon={'trash-2'}
            title={translate(task.parentId ? 'Delete Subtask' : 'Delete Task')}
            type={'ghost'}
            iconColor={colors.UtilityRed200}
            titleStyle={{ color: colors.UtilityRed200 }}
            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
            onPress={onPress}
            accessible={false}
        />
    )
}
