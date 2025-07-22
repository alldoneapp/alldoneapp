import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useSelector, useDispatch } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import AssigneeAndObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal'
import AssigneeButton from './AssigneeButton'
import ObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/ObserversModal'

export default function EditAssigneeWrapper({
    onDismissPopup,
    projectId,
    tmpTask,
    disabled,
    saveAssigneeBeforeSaveTask,
    isAssistant,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [isOpen, setIsOpen] = useState(false)

    const showPopover = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    const delayHidePopover = () => {
        setTimeout(async () => {
            hidePopover()
        })
    }

    const projectIndex = ProjectHelper.getProjectIndexById(projectId)

    return (
        <View style={localStyles.container}>
            <Popover
                content={
                    isAssistant ? (
                        <ObserversModal
                            projectIndex={projectIndex}
                            task={tmpTask}
                            closePopover={hidePopover}
                            delayClosePopover={delayHidePopover}
                            saveDataBeforeSaveObject={saveAssigneeBeforeSaveTask}
                        />
                    ) : (
                        <AssigneeAndObserversModal
                            projectIndex={projectIndex}
                            object={tmpTask}
                            closePopover={hidePopover}
                            delayClosePopover={delayHidePopover}
                            saveDataBeforeSaveObject={saveAssigneeBeforeSaveTask}
                            inEditTask={true}
                            directAssigneeComment={true}
                        />
                    )
                }
                onClickOutside={delayHidePopover}
                isOpen={isOpen}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <AssigneeButton projectId={projectId} task={tmpTask} disabled={disabled} showPopover={showPopover} />
            </Popover>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 8,
        right: 8,
        borderRadius: 50,
        overflow: 'hidden',
    },
})
