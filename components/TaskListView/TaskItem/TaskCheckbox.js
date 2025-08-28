import React from 'react'
import { TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Checkbox from '../../CheckBox'
import Shortcut from '../../UIControls/Shortcut'
import { checkIsLimitedByXp } from '../../Premium/PremiumHelper'

export default function TaskCheckbox({
    tmpTask,
    isSubtask,
    accessGranted,
    showArrowInAnonymous,
    loggedUserCanUpdateObject,
    isAssistant,
    projectId,
    editModeCheckOff,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showShortcuts = useSelector(state => state.showShortcuts)

    const onEditModeCheckOff = () => {
        if (!checkIsLimitedByXp(projectId)) {
            editModeCheckOff()
        }
    }

    return (
        <TouchableOpacity
            onPress={onEditModeCheckOff}
            disabled={!accessGranted || !loggedUserCanUpdateObject}
            style={
                (!loggedUserCanUpdateObject &&
                    tmpTask.subtaskIds.length === 0 &&
                    !isSubtask &&
                    isMiddleScreen &&
                    showArrowInAnonymous) ||
                (isMiddleScreen && isAssistant)
                    ? { marginLeft: -8 }
                    : null
            }
        >
            <Checkbox checked={tmpTask.done} isSubtask={isSubtask} />
            {showShortcuts && accessGranted && loggedUserCanUpdateObject && (
                <View style={{ position: 'absolute', top: -7, left: -2 }}>
                    <Shortcut text={'Shift+D'} />
                </View>
            )}
        </TouchableOpacity>
    )
}
