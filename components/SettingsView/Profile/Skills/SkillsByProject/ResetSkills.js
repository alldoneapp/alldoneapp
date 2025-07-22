import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import { CONFIRM_POPUP_TRIGGER_RESET_SKILLS } from '../../../../UIComponents/ConfirmPopup'
import { showConfirmPopup, showFloatPopup } from '../../../../../redux/actions'

export default function ResetSkills({ projectId, closeAllEdition, containerStyle }) {
    const dispatch = useDispatch()
    const skillsAmount = useSelector(state =>
        state.skillsByProject[projectId] ? state.skillsByProject[projectId].length : 0
    )

    const askToReset = e => {
        closeAllEdition()
        dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_RESET_SKILLS,
                object: {
                    projectId,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to perform this action?',
                },
            }),
        ])
    }

    return (
        <View style={[localStyles.footer, containerStyle]}>
            <View>
                <Button
                    icon={'trash-2'}
                    title={translate('Reset Skills')}
                    type={'ghost'}
                    onPress={askToReset}
                    accessible={false}
                    disabled={skillsAmount === 0}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    footer: {
        marginTop: 24,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
