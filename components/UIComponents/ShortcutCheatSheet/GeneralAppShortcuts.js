import React, { useEffect } from 'react'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import {
    hideNoteAltShortcuts,
    hideNoteCtrlShortcuts,
    setCheckTaskItem,
    setFocusedTaskItem,
    storeCurrentShortcutUser,
    switchShortcutProject,
    showGlobalSearchPopup,
    setSearchText,
} from '../../../redux/actions'
import SharedHelper from '../../../utils/SharedHelper'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { ALL_PROJECTS_INDEX } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../redux/store'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../../Feeds/CommentsTextInput/textInputHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'

export default function GeneralAppShortcuts() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const focusedTaskItem = useSelector(state => state.focusedTaskItem)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const sPIndex = useSelector(state => state.selectedProjectIndex)
    const currentUserId = useSelector(state => state.currentUser.uid)

    useEffect(() => {
        document.addEventListener('keydown', onSidebarShortcut)
        return () => document.removeEventListener('keydown', onSidebarShortcut)
    }, [])

    useEffect(() => {
        dispatch(setFocusedTaskItem('', false))
    }, [sPIndex, currentUserId])

    const onShortcutPress = (s, event) => {
        event.preventDefault()
        if (store.getState().blockShortcuts) {
            return
        }

        const accessGranted = SharedHelper.accessGranted(loggedUser)

        if (s === 'alt+k') {
            openGloablSearchModal()
        }

        if (s === 'alt+shift+f') {
            openGloablSearchModal()
        }

        if (s === 'alt+shift+e') {
            const taskListEls = document.querySelectorAll('[aria-task-id]')

            if (taskListEls.length > 0 && focusedTaskItem.id === '') {
                dispatch(
                    setFocusedTaskItem(
                        taskListEls[0].getAttribute('aria-task-id'),
                        taskListEls[0].getAttribute('is-observed-task') === 'true' ? true : false
                    )
                )
            }
        }

        if (s === 'alt+up' || s === 'alt+down') {
            const taskListEls = document.querySelectorAll('[aria-task-id]')

            if (taskListEls.length > 0) {
                if (focusedTaskItem.id === '') {
                    dispatch(
                        setFocusedTaskItem(
                            taskListEls[0].getAttribute('aria-task-id'),
                            taskListEls[0].getAttribute('is-observed-task') === 'true' ? true : false
                        )
                    )
                } else {
                    const taskListIds = []
                    const taskListIsObservedStates = []

                    taskListEls.forEach(el => {
                        taskListIds.push(el.getAttribute('aria-task-id'))
                        taskListIsObservedStates.push(el.getAttribute('is-observed-task') === 'true' ? true : false)
                    })

                    const sign = s === 'alt+down' ? 1 : -1
                    let index = taskListIds.indexOf(focusedTaskItem.id) + sign

                    if (index >= taskListIds.length) {
                        index = 0
                    } else if (index < 0) {
                        index = taskListIds.length - 1
                    }

                    document.getElementById('root').click()
                    dispatch(setFocusedTaskItem(taskListIds[index], taskListIsObservedStates[index]))
                }
            }
        }

        if (s === 'alt+shift+d' && accessGranted) {
            const taskListEls = document.querySelectorAll('[aria-task-id]')

            if (taskListEls.length > 0) {
                if (focusedTaskItem.id === '') {
                    dispatch(
                        setCheckTaskItem(
                            taskListEls[0].getAttribute('aria-task-id'),
                            taskListEls[0].getAttribute('is-observed-task') === 'true' ? true : false
                        )
                    )
                } else {
                    dispatch(setCheckTaskItem(focusedTaskItem.id, focusedTaskItem.isObserved))
                }
            }
        }
    }

    const openGloablSearchModal = () => {
        const openModals = document.getElementsByClassName(`react-tiny-popover-container`)
        const openNoteToolbarModals = document.getElementsByClassName(`ql-expanded`)
        if (
            openModals.length === 0 &&
            openNoteToolbarModals.length === 0 &&
            !store.getState().showConfirmPopupData.visible &&
            !exitsOpenModals([RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID])
        ) {
            const { isAnonymous } = loggedUser
            if (!isAnonymous) {
                store.dispatch([setSearchText(''), showGlobalSearchPopup(true)])
            }
        }
    }

    const onSidebarShortcut = event => {
        if (store.getState().blockShortcuts) {
            return
        }

        if (event.altKey && (event.key === '>' || event.key === '<')) {
            // onSidebarUsers(event)
        } else if (event.altKey && event.shiftKey && event.code.startsWith('Digit')) {
            onSidebarProject(event)
        }
    }

    const onSidebarProject = event => {
        const showShortcut = showFloatPopup === 0 && !exitsOpenModals()

        if (showShortcut) {
            event.preventDefault()
            let index = parseInt(event.code.substr(5))

            const projectsElem = document.querySelectorAll(`[aria-label="sidebar-project-${index}"]`)
            if (index === 0 || projectsElem.length > 0) {
                if (index === 0) {
                    index = ALL_PROJECTS_INDEX
                } else {
                    const parts = projectsElem[0].getAttribute('id').split('-')
                    index = parts[parts.length - 1]
                }

                dispatch([switchShortcutProject(index), hideNoteCtrlShortcuts(), hideNoteAltShortcuts()])
            }
        }
    }

    const onSidebarUsers = event => {
        const showShortcut = showFloatPopup === 0 && !exitsOpenModals()

        if (showShortcut) {
            event.preventDefault()

            const projectsElem = document.querySelectorAll('[aria-label="sidebar-user-item"]')
            let uidList = []
            let selectedIndex = 0
            projectsElem.forEach(elem => uidList.push(elem.getAttribute('id').split('@')[1]))

            for (let index in uidList) {
                if (uidList[index] === currentUserId) {
                    selectedIndex = parseInt(index)
                }
            }

            let newIndex = 0
            if (event.key === '<') {
                newIndex = selectedIndex + 1

                if (selectedIndex === uidList.length - 1) {
                    newIndex = 0
                }
            } else if (event.key === '>') {
                newIndex = selectedIndex - 1

                if (selectedIndex === 0) {
                    newIndex = uidList.length - 1
                }
            }

            dispatch([storeCurrentShortcutUser(uidList[newIndex]), hideNoteCtrlShortcuts(), hideNoteAltShortcuts()])
        }
    }

    return (
        <>
            <Hotkeys
                keyName={'alt+shift+d,alt+shift+e,alt+up,alt+down,alt+k,alt+shift+f,,alt+shift+m'}
                onKeyDown={onShortcutPress}
                filter={e => true}
            />
        </>
    )
}
