import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import { colors } from '../../../styles/global'
import { UNLOCK_GOAL_COST } from '../../../Guides/guidesHelper'
import RunOutOfGoldForUnlockModal from './RunOutOfGoldForUnlockModal'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import store from '../../../../redux/store'
import { addLockKeyToGoalOwner, addLockKeyToLoggedUser } from '../../../../utils/backends/Users/usersFirestore'

export default function UnlockButton({ projectId, lockKey, goalId, ownerId }) {
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
            <Button
                title={translate('Unlock tasks', {
                    goldAmount: UNLOCK_GOAL_COST,
                })}
                onPress={unlockGoal}
                type={'secondary'}
                buttonStyle={{ backgroundColor: colors.UtilityYellow150 }}
            />
        </Popover>
    )
}
