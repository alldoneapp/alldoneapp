import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import Backend from '../../../../utils/BackendBridge'

export default function CreateSubscriptionButtonsArea({ selectedUserIds, openPaymenthMethods, resetData }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const goNextStep = () => {
        openPaymenthMethods()
        Backend.logEvent('click_connect_payment', {
            userId: loggedUserId,
        })
    }

    return (
        <View style={localStyles.buttons}>
            <Button title={'Cancel'} type={'secondary'} onPress={resetData} />
            <Button
                title={translate('Connect payment method')}
                icon={'credit-card'}
                iconSize={20}
                buttonStyle={{ marginLeft: 8 }}
                disabled={selectedUserIds.length === 0}
                onPress={goNextStep}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
})
