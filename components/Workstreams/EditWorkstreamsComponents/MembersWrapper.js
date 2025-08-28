import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import AssigneesIcon from '../../GoalsView/EditGoalsComponents/AssigneesIcon'
import WorkstreamMembersModal from '../../UIComponents/FloatModals/WorkstreamMembersModal/WorkstreamMembersModal'
import Backend from '../../../utils/BackendBridge'
import { translate } from '../../../i18n/TranslationService'
import { setWorkstreamMembers } from '../../../utils/backends/Workstreams/workstreamsFirestore'

export default function MembersWrapper({
    stream,
    updateMembers,
    projectId,
    projectIndex,
    buttonStyle,
    closeEditModal,
    inMentionModal = false,
    disabled = false,
}) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { displayName, userIds } = stream

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
        if (stream?.uid != null) {
            closeEditModal?.()
        }
    }

    const updateUsers = userList => {
        this.setTimeout(() => {
            closeModal()
            const userIds = userList.map(user => user.uid)
            if (updateMembers) {
                updateMembers(userIds)
            } else {
                setWorkstreamMembers(projectId, stream.uid, userIds, stream.userIds)
            }
        })
    }

    const cleanedName = displayName.trim()
    return (
        <Popover
            content={
                <WorkstreamMembersModal
                    closeModal={closeModal}
                    updateUsers={updateUsers}
                    initialUserIds={userIds}
                    projectIndex={projectIndex}
                    projectId={projectId}
                />
            }
            align={'start'}
            position={['bottom', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+A'}
                disabled={!cleanedName || disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.assigneesBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.assigneesBtnRef = ref)}
                    title={inMentionModal || smallScreen ? null : translate('Members')}
                    type={'ghost'}
                    noBorder={inMentionModal || smallScreen}
                    icon={userIds.length === 0 ? 'users' : undefined}
                    customIcon={
                        userIds.length > 0 ? (
                            <AssigneesIcon assigneesIds={userIds} disableModal={true} projectId={projectId} />
                        ) : undefined
                    }
                    buttonStyle={[{ marginRight: 4 }, buttonStyle]}
                    onPress={openModal}
                    disabled={!cleanedName || isOpen || disabled}
                    shortcutText={'A'}
                />
            </Hotkeys>
        </Popover>
    )
}
