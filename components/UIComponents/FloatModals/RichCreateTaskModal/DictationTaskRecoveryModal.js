import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../../ModalShell/AppPopover'
import useModalSizing from '../../../../hooks/useModalSizing'
import useFloatPopupLock from '../../../../hooks/useFloatPopupLock'
import useTaskEditorLock from '../../../../hooks/useTaskEditorLock'
import { popoverToCenter, popoverToTopContainerStyle } from '../../../../utils/HelperFunctions'
import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import { AUTOMATIC_PROJECT_OPTION } from '../SelectProjectModal/projectPickerConstants'
import RichCreateTaskModal from './RichCreateTaskModal'
import { closeDictationTaskRecovery, useDictationTaskRecovery } from './dictationTaskRecovery'

/**
 * PT-5425: reopens the add-task popup with the draft of a dictated task that could not be created
 * in the background (see `claimDictatedTaskInBackground` in RichCreateTaskModal.js). Mounted once with the global modals, so it
 * works whichever opener the original popup came from — that opener may no longer exist.
 *
 * It renders the ordinary RichCreateTaskModal, so the restored popup behaves exactly like the one
 * the user left: project (or "Automatic"), due date, assignee, goal and the typed or dictated
 * title come back from the draft, and holding the mic again takes the same background path.
 */
export default function DictationTaskRecoveryModal() {
    const recovery = useDictationTaskRecovery()
    if (!recovery) return null
    return <RecoveryPopup key={recovery.id} recovery={recovery} />
}

function RecoveryPopup({ recovery }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const { isSheet } = useModalSizing()
    const popupLock = useFloatPopupLock()
    const taskEditorLock = useTaskEditorLock()

    useEffect(() => {
        popupLock.acquire()
        taskEditorLock.acquire()
    }, [])

    const close = () => {
        // Same rule as every other opener: a click in the mention picker or the tag editor is not
        // a dismissal of the popup underneath it.
        if (isQuillTagEditorOpen || openModals?.[MENTION_MODAL_ID]) return
        closeDictationTaskRecovery(recovery.id)
    }

    return (
        <View style={[localStyles.container, isSheet && NO_POINTER_EVENTS_STYLE]}>
            <View style={localStyles.popup}>
                <AppPopover
                    content={
                        <RichCreateTaskModal
                            initialProjectId={recovery.automaticProject ? AUTOMATIC_PROJECT_OPTION : recovery.projectId}
                            initialTask={recovery.task}
                            fromTaskList={true}
                            useLoggedUser={true}
                            modalTitle={recovery.modalTitle}
                            closeModal={() => closeDictationTaskRecovery(recovery.id)}
                        />
                    }
                    onClickOutside={close}
                    isOpen={true}
                    padding={4}
                    contentLocation={popoverData => popoverToCenter(popoverData, smallScreenNavigation)}
                    containerStyle={popoverToTopContainerStyle}
                >
                    <Text />
                </AppPopover>
            </View>
        </View>
    )
}

const NO_POINTER_EVENTS_STYLE = { pointerEvents: 'none' }

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
    popup: {
        alignItems: 'center',
    },
})
