import React from 'react'
import { colors } from '../../../styles/global'
import { showConfirmPopup } from '../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_NOTE } from '../../../UIComponents/ConfirmPopup'
import { useDispatch } from 'react-redux'
import Button from '../../../UIControls/Button'
import { DV_TAB_ROOT_NOTES } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'

export default function DeleteNoteButton({ projectId, note }) {
    const dispatch = useDispatch()

    const onPress = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_NOTE,
                object: {
                    note,
                    projectId,
                    navigation: DV_TAB_ROOT_NOTES,
                    originalNoteTitle: note.title,
                },
            })
        )
    }
    return (
        <Button
            icon={'trash-2'}
            title={translate('Delete Note')}
            type={'ghost'}
            iconColor={colors.UtilityRed200}
            titleStyle={{ color: colors.UtilityRed200 }}
            buttonStyle={{ borderColor: colors.UtilityRed200, borderWidth: 2 }}
            onPress={onPress}
            accessible={false}
        />
    )
}
