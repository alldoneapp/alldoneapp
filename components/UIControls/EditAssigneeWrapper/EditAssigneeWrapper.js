import React, { useEffect, useRef, useState } from 'react'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import AssigneeAndObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal'
import AssigneeButton from './AssigneeButton'
import ObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/ObserversModal'
import useFloatPopupLock from '../../../hooks/useFloatPopupLock'

export default function EditAssigneeWrapper({
    onDismissPopup,
    projectId,
    tmpTask,
    disabled,
    saveAssigneeBeforeSaveTask,
    isAssistant,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [isOpen, setIsOpen] = useState(false)
    const isUnmountedRef = useRef(false)
    const popupLock = useFloatPopupLock()

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
        popupLock.acquire()
    }

    const hidePopover = () => {
        safeSetIsOpen(false)
        popupLock.release()
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
                <AppPopover
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
                </AppPopover>
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
