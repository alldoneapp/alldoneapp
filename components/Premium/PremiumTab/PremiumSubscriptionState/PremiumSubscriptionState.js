import { isEqual } from 'lodash'
import React, { useState, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import { updateUserIdsInSubscription } from '../../../../utils/backends/Premium/premiumFirestore'
import { colors } from '../../../styles/global'
import { removeUsersPaidByOtherUser } from '../../PremiumHelper'
import CompanyPreview from '../CompanyPreview/CompanyPreview'

export default function PremiumSubscriptionState({ subscription }) {
    const projectUsers = useSelector(state => state.projectUsers)
    const [companyData, setCompanyData] = useState(subscription.companyData)

    const checkForUsersPaidByOtherUser = async () => {
        const newSelectedUserIds = await removeUsersPaidByOtherUser(subscription.selectedUserIds)
        if (!isEqual(newSelectedUserIds, subscription.selectedUserIds)) updateUserIdsInSubscription(newSelectedUserIds)
    }

    useEffect(() => {
        checkForUsersPaidByOtherUser()
    }, [projectUsers, subscription.selectedUserIds])

    const { status } = subscription

    return (
        <View style={localStyles.container}>
            <CompanyPreview
                key={status}
                subscription={subscription}
                companyData={companyData}
                setCompanyData={setCompanyData}
                selectedUserIds={subscription.selectedUserIds}
                inCompanyPreviewStep={true}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Gray200,
        borderRadius: 4,
        paddingBottom: 16,
        marginBottom: 22,
    },
})
