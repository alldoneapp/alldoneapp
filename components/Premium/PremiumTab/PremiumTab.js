import React, { useEffect, useState } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import global from '../../styles/global'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import URLsSettings from '../../../URLSystem/Settings/URLsSettings'
import PremiumSubscriptionState from './PremiumSubscriptionState/PremiumSubscriptionState'
import { translate } from '../../../i18n/TranslationService'
import FreePlanArea from './FreePlanArea/FreePlanArea'
import SubscriptionPaidByOtherUser from './SubscriptionPaidByOtherUser/SubscriptionPaidByOtherUser'
import useSubscriptionPaidByOtherUser from './useSubscriptionPaidByOtherUser'
import useSubscription from './useSubscription'
import CreatePremiumSubscription from './CreatePremiumSubscription/CreatePremiumSubscription'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'

export default function PremiumTab() {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const subscription = useSubscription(loggedUserId)
    const subscriptionPaidByOtherUser = useSubscriptionPaidByOtherUser(loggedUserId)
    const [subscriptionLoaded, setSubscriptionLoaded] = useState(false)

    useEffect(() => {
        if (subscription === null) {
            dispatch(startLoadingData())
        } else if (!subscriptionLoaded) {
            dispatch(stopLoadingData())
            setSubscriptionLoaded(true)
        }
    }, [subscription])

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        URLsSettings.push(DV_TAB_SETTINGS_PREMIUM)
    }

    useEffect(() => {
        Backend.logEvent('open_premium_tab', {
            userId: loggedUserId,
        })
    }, [])

    return subscriptionLoaded ? (
        <View style={{ marginBottom: 56 }}>
            <Text style={localStyles.headerText}>{translate('Premium')}</Text>
            {subscriptionPaidByOtherUser && <SubscriptionPaidByOtherUser subscription={subscriptionPaidByOtherUser} />}
            {subscription ? <PremiumSubscriptionState subscription={subscription} /> : <CreatePremiumSubscription />}
            <FreePlanArea />
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    headerText: {
        ...global.title6,
        marginTop: 32,
        marginBottom: 12,
    },
})
