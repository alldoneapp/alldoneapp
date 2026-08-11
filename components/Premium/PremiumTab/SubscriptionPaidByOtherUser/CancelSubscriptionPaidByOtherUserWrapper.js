import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import ConfirmationModal from '../ConfirmationModal'
import { removeUserFromSubscription } from '../../../../utils/backends/Premium/premiumFirestore'

export default function CancelSubscriptionPaidByOtherUserWrapper({ userPayingId }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [showModal, setShowModal] = useState(false)

    const cancelSubscriptionPaidByOtherUser = async () => {
        await removeUserFromSubscription({ userPayingId, userId: loggedUserId })
        closeModal()
    }

    const closeModal = () => {
        setShowModal(false)
    }

    const openModal = () => {
        setShowModal(true)
    }

    return (
        <Popover
            isOpen={showModal}
            content={
                <ConfirmationModal
                    onProceed={cancelSubscriptionPaidByOtherUser}
                    closeModal={closeModal}
                    title="Be careful, this action is permanent"
                    description="Do you really want to perform this action and lose the premium status"
                />
            }
        >
            <Button
                icon={'cap'}
                title={translate('Downgrade to Free')}
                type={'ghost'}
                iconColor={colors.UtilityRed200}
                titleStyle={{ color: colors.UtilityRed200 }}
                buttonStyle={{
                    borderColor: colors.UtilityRed200,
                    borderWidth: 2,
                    marginTop: 24,
                    alignSelf: 'center',
                }}
                accessible={false}
                onPress={openModal}
            />
        </Popover>
    )
}
