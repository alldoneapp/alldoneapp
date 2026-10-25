import React from 'react'
import { StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { showConfirmPopup } from '../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_USER, CONFIRM_POPUP_TRIGGER_INFO } from '../../../UIComponents/ConfirmPopup'

export default function RemoveUser({ user }) {
    const dispatch = useDispatch()
    const adminEmail = useSelector(state => state.administratorUser.email)

    const openDeleteUserModal = () => {
        const templateIds = (user && (user.realTemplateProjectIds || user.templateProjectIds)) || []
        if (templateIds.length > 0) {
            // Blocked branch: the same global dialog system as the positive
            // branch below, instead of a bespoke popover (INFO renders a
            // single Ok button).
            dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_INFO,
                    object: {
                        headerText: 'You cannot delete your user',
                        headerQuestion: 'Your account has some active templates',
                        headerQuestionParams: { email: adminEmail },
                    },
                })
            )
        } else {
            dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_DELETE_USER,
                    object: {
                        headerText: 'Be careful, this action is permanent',
                        headerQuestion: `Do you really want to delete this account`,
                        headerExclamationSentence: user && user.email,
                        user,
                    },
                })
            )
        }
    }

    return (
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
    )
}

const localStyles = StyleSheet.create({
    deleteButton: {
        borderColor: colors.UtilityRed200,
        borderWidth: 2,
        marginTop: 16,
    },
})
