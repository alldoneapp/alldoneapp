import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import SelectPremiumUsersModal from '../SelectPremiumUsersModal/SelectPremiumUsersModal'
import CompanyInfoModal from '../CompanyInfoModal/CompanyInfoModal'
import { popoverToCenter } from '../../../../utils/HelperFunctions'
import Backend from '../../../../utils/BackendBridge'

const MODALS_CLOSED = 0
const SELECT_USERS_MODAL_OPEN = 1
const INFO_MODAL_OPEN = 2

export default function CreateCompanyWrapper({
    openCompanyPreview,
    selectedUserIds,
    setSelectedUsersIds,
    companyData,
    setCompanyData,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [modalState, setModalState] = useState(MODALS_CLOSED)

    const closeModal = () => {
        setModalState(MODALS_CLOSED)
    }

    const openInfoModal = tmpSelectedUsersIds => {
        setSelectedUsersIds(tmpSelectedUsersIds)
        setModalState(INFO_MODAL_OPEN)
    }

    const openSelectUsersModal = () => {
        setModalState(SELECT_USERS_MODAL_OPEN)
        Backend.logEvent('click_on_upgrade_to_premium', {
            userId: loggedUserId,
        })
    }

    return (
        <Popover
            content={
                <View>
                    {modalState === SELECT_USERS_MODAL_OPEN && (
                        <SelectPremiumUsersModal
                            closeModal={closeModal}
                            originalSelectedUsersIds={selectedUserIds}
                            onClickButton={openInfoModal}
                        />
                    )}
                    {modalState === INFO_MODAL_OPEN && (
                        <CompanyInfoModal
                            openCompanyPreview={openCompanyPreview}
                            closeModal={closeModal}
                            companyData={companyData}
                            setCompanyData={setCompanyData}
                        />
                    )}
                </View>
            }
            onClickOutside={closeModal}
            isOpen={modalState !== MODALS_CLOSED}
            disableReposition={smallScreenNavigation}
            contentLocation={smallScreenNavigation && popoverToCenter}
            position={['top', 'left', 'right', 'bottom']}
            align={'center'}
            padding={4}
        >
            <Button
                title={translate('Upgrade to Premium')}
                icon={'crown'}
                iconSize={20}
                buttonStyle={localStyles.button}
                onPress={openSelectUsersModal}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    button: {
        marginTop: 32,
        alignSelf: 'center',
    },
})
