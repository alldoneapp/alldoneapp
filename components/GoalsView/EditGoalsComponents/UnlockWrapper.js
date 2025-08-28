import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import { UNLOCK_GOAL_COST } from '../../Guides/guidesHelper'
import RunOutOfGoldForUnlockModal from '../../UIComponents/FloatModals/LockedGoalModal/RunOutOfGoldForUnlockModal'
import { translate } from '../../../i18n/TranslationService'
import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import store from '../../../redux/store'
import { addLockKeyToGoalOwner, addLockKeyToLoggedUser } from '../../../utils/backends/Users/usersFirestore'

export default function UnlockWrapper({ projectId, lockKey, goalId, ownerId }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const unlockGoal = () => {
        const { loggedUser, administratorUser } = store.getState()
        const isCreator =
            administratorUser.uid === loggedUser.uid || loggedUser.realTemplateProjectIds.includes(projectId)
        loggedUser.gold >= UNLOCK_GOAL_COST
            ? isCreator
                ? addLockKeyToGoalOwner(loggedUser.uid, projectId, lockKey, goalId, ownerId)
                : addLockKeyToLoggedUser(loggedUser.uid, projectId, lockKey, goalId)
            : openModal()
    }

    return (
        <Popover
            isOpen={isOpen}
            onClickOutside={closeModal}
            align={'center'}
            position={['right', 'bottom', 'top']}
            content={<RunOutOfGoldForUnlockModal closeModal={closeModal} projectId={projectId} />}
        >
            <Hotkeys
                keyName={'alt+U'}
                onKeyDown={(sht, event) => execShortcutFn(this.unlockBtnRef, unlockGoal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.unlockBtnRef = ref)}
                    title={smallScreen ? null : translate('Unlock', { goldAmount: UNLOCK_GOAL_COST })}
                    type={'secondary'}
                    noBorder={smallScreen}
                    icon={'key'}
                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                    onPress={unlockGoal}
                    shortcutText={'U'}
                />
            </Hotkeys>
        </Popover>
    )
}
