import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import { PRICE } from '../../PremiumHelper'

export default function SelectPremiumUsersModal({ selectedUsersAmount }) {
    return (
        <View style={localStyles.containger}>
            <View style={localStyles.info}>
                <Icon name={'info'} size={16} color={colors.Text03} style={{ marginRight: 8 }} />
                <Text style={localStyles.selectedUsers}>
                    {`${selectedUsersAmount} ${translate(selectedUsersAmount === 1 ? 'user' : 'users')} ${translate(
                        selectedUsersAmount === 1 ? 'selectedSingular' : 'selectedPlural'
                    )}.`}
                </Text>
            </View>
            <Text style={localStyles.payment}>{`${translate('Expected monthly payment:')} ${
                selectedUsersAmount * PRICE
            } EUR`}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    containger: {
        paddingHorizontal: 8,
    },
    selectedUsers: {
        ...styles.body2,
        color: colors.Text03,
    },
    payment: {
        ...styles.body2,
        color: colors.Text03,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
