import React, { useState } from 'react'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import CompanyAddressModal from './CompanyAddressModal'
import { popoverToCenter } from '../../../../utils/HelperFunctions'

export default function CompanyAddressModalWrapper({ usePersistentSave, companyData, setCompanyData, subscription }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [showModal, setShowModal] = useState(false)

    const closeModal = () => {
        setShowModal(false)
    }

    const openModal = () => {
        setShowModal(true)
    }

    return (
        <AppPopover
            isOpen={showModal}
            disableReposition={smallScreenNavigation}
            contentLocation={smallScreenNavigation && popoverToCenter}
            position={['right', 'top', 'left', 'bottom']}
            align={'center'}
            onClickOutside={closeModal}
            content={
                <CompanyAddressModal
                    closeModal={closeModal}
                    companyData={companyData}
                    setCompanyData={setCompanyData}
                    usePersistentSave={usePersistentSave}
                    subscription={subscription}
                />
            }
        >
            <Button
                type={'ghost'}
                title={translate('Edit address')}
                icon={'edit-2'}
                buttonStyle={{ marginTop: 8 }}
                onPress={openModal}
            />
        </AppPopover>
    )
}
