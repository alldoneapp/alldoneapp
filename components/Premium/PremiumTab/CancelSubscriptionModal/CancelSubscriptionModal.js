import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import SadEmoji from '../../../../assets/svg/SadEmoji'
import { translate } from '../../../../i18n/TranslationService'
import Line from '../../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import { cancelSubscription } from '../../../../utils/backends/Premium/premiumFirestore'

export default function CancelSubscriptionModal({ subscription, closeModal }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [processing, setProcessing] = useState(false)

    const { nextPaymentDate, activePaidUsersIds } = subscription
    const subscriptionEndDate = moment(nextPaymentDate).format('DD.MM.YYYY')

    const onKeyDown = event => {
        if (event.key === 'Enter') cancelPremiumSubscription()
    }

    const cancelPremiumSubscription = async () => {
        setProcessing(true)
        await cancelSubscription({ userPayingId: loggedUserId })
        setProcessing(false)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return (
        <View style={localStyles.container}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Cancel Premium plan')}
                description={`${translate('Cancel Premium plan description')} ${subscriptionEndDate}`}
            />
            <View style={{ alignItems: 'center' }}>
                <Text style={localStyles.message}>{translate('We sorry you are leaving')} </Text>
                <SadEmoji />
            </View>
            <Line style={localStyles.line} />
            <Button
                title={translate('Downgrade to Free')}
                icon={!processing && 'cap'}
                type={'danger'}
                buttonStyle={{ alignSelf: 'center' }}
                onPress={cancelPremiumSubscription}
                disabled={processing}
                processing={processing}
                processingTitle={translate('Loading')}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        width: 305,
        height: 315,
    },
    line: {
        marginVertical: 16,
    },
    message: {
        ...styles.title6,
        color: '#fff',
        marginBottom: 16,
    },
})
