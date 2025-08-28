import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import UserAvatarAndName from './UserAvatarAndName'
import PremiumSvg from '../../../../assets/svg/PremiumSvg'
import useGetUserPresentationData from '../../../ContactsView/Utils/useGetUserPresentationData'

export default function CompanyData({ subscription }) {
    const { userPayingId, name, firstPaymentDate, pending } = subscription
    const userPaying = useGetUserPresentationData(userPayingId)

    const paidByText = `${translate('Premium paid by')} ${name ? name : userPaying.displayName}`
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <PremiumSvg height={34} width={34} style={{ marginRight: 8 }} />
                <Text style={localStyles.name}>{paidByText}</Text>
            </View>
            <UserAvatarAndName
                userPayingId={userPayingId}
                userData={userPaying}
                pending={pending}
                firstPaymentDate={firstPaymentDate}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        marginTop: 8,
    },
    name: {
        ...styles.title6,
        borderColor: colors.Text01,
    },
})
