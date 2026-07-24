import React, { useEffect, useRef, useState } from 'react'
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
    const isUnmountedRef = useRef(false)

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        }
    }

    const showPopover = () => {
        safeSetIsOpen(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        safeSetIsOpen(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    const delayHidePopover = () => {
        setTimeout(() => {
            hidePopover()
        })
    }

    const projectIndex = ProjectHelper.getProjectIndexById(projectId)

    return (
        <View style={localStyles.container}>
            {isOpen ? (
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
                    isOpen
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={smallScreen ? null : undefined}
                    disableReposition
                >
                    <AssigneeButton
                        projectId={projectId}
                        task={tmpTask}
                        disabled={disabled}
                        showPopover={showPopover}
                    />
                </Popover>
            ) : (
                <AssigneeButton projectId={projectId} task={tmpTask} disabled={disabled} showPopover={showPopover} />
            )}
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
