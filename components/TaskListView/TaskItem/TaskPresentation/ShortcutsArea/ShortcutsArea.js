import React from 'react'
import { useSelector } from 'react-redux'

import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import ShortcutContainer from './ShortcutContainer'

export default function ShortcutsArea({ task, isActiveOrganizeMode, accessGranted, projectId, isLocked }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const shortcutFocusTasks = useSelector(state => state.shortcutFocusTasks)
    const activeEditMode = useSelector(state => state.activeEditMode)

    const isFocusTask = shortcutFocusTasks?.current === task.id
    const canBeOpen = isFocusTask && !isActiveOrganizeMode && !isLocked

    const loggedUserIsTaskOwner = loggedUserId === task.userId
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const canBeMovedForward = canBeOpen && loggedUserCanUpdateObject && accessGranted

    const isPreviousTaskToOpenTask = activeEditMode && shortcutFocusTasks?.prev === task.id
    const isNextTaskToOpenTask = activeEditMode && shortcutFocusTasks?.next === task.id

    return showShortcuts ? (
        <>
            {canBeOpen && <ShortcutContainer containerStyle={{ right: 14 }} text={'Shift+E'} />}
            {canBeMovedForward && <ShortcutContainer containerStyle={{ left: 14 }} text={'Shift+D'} />}
            {isPreviousTaskToOpenTask && (
                <ShortcutContainer
                    containerStyle={{ right: 12 }}
                    icon="arrow-up-symbol"
                    shortcutStyle={{ paddingHorizontal: 2 }}
                />
            )}
            {isNextTaskToOpenTask && (
                <ShortcutContainer
                    containerStyle={{ right: 12 }}
                    icon="arrow-down-symbol"
                    shortcutStyle={{ paddingHorizontal: 2 }}
                />
            )}
        </>
    ) : null
}
