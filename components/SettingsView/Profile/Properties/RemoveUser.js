import React, { useState } from 'react'
import { StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { showConfirmPopup } from '../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_USER } from '../../../UIComponents/ConfirmPopup'
import NotAllowRemoveUserModal from './NotAllowRemoveUserModal'

export default function RemoveUser({ user }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const adminEmail = useSelector(state => state.administratorUser.email)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const openDeleteUserModal = () => {
        if (user.realTemplateProjectIds.length > 0) {
            openModal()
        } else {
            dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_DELETE_USER,
                    object: {
                        headerText: 'Be careful, this action is permanent',
                        headerQuestion: `Do you really want to delete this account`,
                        headerExclamationSentence: user.email,
                        user,
                    },
                })
            )
        }
    }

    return (
        <Popover
            content={
                <NotAllowRemoveUserModal
                    closeModal={closeModal}
                    title={translate('You cannot delete your user')}
                    description={translate('Your account has some active templates', { email: adminEmail })}
                />
            }
            align={'start'}
            position={['top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Button
                icon={'trash-2'}
                title={translate('Delete Account')}
                type={'ghost'}
                iconColor={colors.UtilityRed200}
                titleStyle={{ color: colors.UtilityRed200 }}
                buttonStyle={localStyles.deleteButton}
                onPress={openDeleteUserModal}
                accessible={false}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    deleteButton: {
        borderColor: colors.UtilityRed200,
        borderWidth: 2,
        marginTop: 16,
    },
})
