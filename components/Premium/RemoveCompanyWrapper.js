import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'
import ConfirmationModal from './PremiumTab/ConfirmationModal'

export default function RemoveCompanyWrapper({ removeCompany }) {
    const [showModal, setShowModal] = useState(false)

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
                    onProceed={removeCompany}
                    closeModal={closeModal}
                    title="Be careful, this action is permanent"
                    description="Do you really want to perform this action and loose the data entered till now"
                />
            }
        >
            <Button
                title={translate('Remove completely')}
                type={'secondary'}
                icon={'trash-2'}
                buttonStyle={{ marginRight: 8 }}
                onPress={openModal}
            />
        </Popover>
    )
}
