import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import CreditCard from '../../../../assets/svg/CreditCard'
import Circle from '../../../../assets/svg/Circle'
import CheckCircle from '../../../../assets/svg/CheckCircle'
import { PAYMENT_METHOD_CREDIT_CARD } from '../../PremiumHelper'

export default function CreditCardMethod({ setPaymentMethod, selected }) {
    const selectMethod = () => {
        setPaymentMethod(PAYMENT_METHOD_CREDIT_CARD)
    }

    return (
        <TouchableOpacity style={localStyles.button} onPress={selectMethod}>
            <View style={localStyles.circleContainer}>{selected ? <CheckCircle /> : <Circle />}</View>
            <CreditCard />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        boxShadow: `${0}px ${4}px ${6}px rgba(0,0,0,0.04), ${0}px ${2}px ${3}px rgba(0,0,0,0.04)`,
        marginRight: 8,
        width: 134,
    },
    circleContainer: {
        position: 'absolute',
        top: 4,
        right: 0,
    },
})
