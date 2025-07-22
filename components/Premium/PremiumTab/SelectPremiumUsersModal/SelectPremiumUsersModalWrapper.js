import React, { useState } from 'react'
import { StyleSheet } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import SelectPremiumUsersModal from '../SelectPremiumUsersModal/SelectPremiumUsersModal'
import { updateUserIdsInSubscription } from '../../../../utils/backends/Premium/premiumFirestore'
import { popoverToCenter } from '../../../../utils/HelperFunctions'

export default function SelectPremiumUsersModalWrapper({
    usePersistentSave,
    selectedUserIds,
    setSelectedUsersIds,
    subscription,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [showModal, setShowModal] = useState(false)

    const closeModal = () => {
        setShowModal(false)
    }

    const openModal = () => {
        setShowModal(true)
    }

    const updateUsersIds = tmpSelectedUsersIds => {
        usePersistentSave ? updateUserIdsInSubscription(tmpSelectedUsersIds) : setSelectedUsersIds(tmpSelectedUsersIds)
        closeModal()
    }

    return (
        <Popover
            content={
                <SelectPremiumUsersModal
                    closeModal={closeModal}
                    originalSelectedUsersIds={selectedUserIds}
                    onClickButton={updateUsersIds}
                    allowSaveWithoutSelectedUsers={true}
                    subscription={subscription}
                />
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            disableReposition={smallScreenNavigation}
            contentLocation={smallScreenNavigation && popoverToCenter}
            position={['top', 'left', 'right', 'bottom']}
            align={'center'}
            padding={4}
        >
            <Button
                title={translate('Edit users')}
                type={'ghost'}
                icon={'edit'}
                buttonStyle={localStyles.button}
                onPress={openModal}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    button: {
        paddingVertical: 13,
        paddingHorizontal: 16,
        marginTop: 16,
        marginBottom: 32,
    },
})
