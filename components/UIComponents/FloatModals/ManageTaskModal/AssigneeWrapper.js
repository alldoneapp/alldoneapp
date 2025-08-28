import React, { useState } from 'react'
import { StyleSheet, TouchableOpacity, Image, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Shortcut from '../../../UIControls/Shortcut'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'
import AssigneeAndObserversModal from '../AssigneeAndObserversModal/AssigneeAndObserversModal'
import ObserversModal from '../AssigneeAndObserversModal/ObserversModal'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import Icon from '../../../Icon'
import { WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'

export default function AssigneeWrapper({
    task,
    projectId,
    setAssigneeAndObservers,
    photoURL,
    updateTask,
    disabled = false,
    setObserversDirectly,
}) {
    const [isOpen, setIsOpen] = useState(false)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const isWorkstream = task.userId.startsWith(WORKSTREAM_ID_PREFIX)
    const allowAssignAndComment = task?.extendedName?.trim() !== ''

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const selectAssignee = (user, observers) => {
        closeModal()
        setAssigneeAndObservers(user, observers)
    }

    const projectIndex = ProjectHelper.getProjectIndexById(projectId)
    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    return (
        <Popover
            content={
                isAssistant ? (
                    <ObserversModal
                        projectIndex={projectIndex}
                        task={task}
                        onSaveData={(assignee, observers) => {
                            setObserversDirectly(observers)
                        }}
                        closePopover={closeModal}
                        delayClosePopover={closeModal}
                    />
                ) : (
                    <AssigneeAndObserversModal
                        projectIndex={projectIndex}
                        object={task}
                        onSaveData={selectAssignee}
                        closePopover={closeModal}
                        delayClosePopover={closeModal}
                        inEditTask={allowAssignAndComment}
                        updateTask={updateTask}
                    />
                )
            }
            align={'start'}
            position={['left']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <Hotkeys
                keyName={'alt+a'}
                onKeyDown={(sht, event) => execShortcutFn(this.assigneeBtnRef, openModal, event)}
                disabled={disabled || isOpen}
                filter={e => true}
            >
                <TouchableOpacity
                    ref={ref => (this.assigneeBtnRef = ref)}
                    style={localStyles.avatarButton}
                    onPress={openModal}
                    disabled={disabled || isOpen}
                    accessible={false}
                >
                    {showShortcuts ? (
                        <View style={[localStyles.shortcut, disabled && localStyles.disabled]}>
                            <Shortcut text={'A'} />
                        </View>
                    ) : isWorkstream ? (
                        <Icon
                            size={24}
                            name="workstream"
                            color={'#ffffff'}
                            style={[localStyles.avatar, disabled && localStyles.disabled]}
                        />
                    ) : photoURL != null && photoURL !== '' ? (
                        <Image
                            source={{ uri: photoURL }}
                            style={[localStyles.avatar, disabled && localStyles.disabled]}
                        />
                    ) : (
                        <View style={[localStyles.avatar, disabled && localStyles.disabled]}>
                            <SVGGenericUser width={24} height={24} svgid={`ci_p_assignee_w_${projectId}`} />
                        </View>
                    )}
                </TouchableOpacity>
            </Hotkeys>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    avatarButton: {
        marginLeft: 8,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
        overflow: 'hidden',
    },
    shortcut: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: 'rgba(138, 148, 166, 0.24)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    disabled: {
        opacity: 0.5,
    },
})
