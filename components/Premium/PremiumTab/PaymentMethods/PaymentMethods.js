import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { PAYMENT_METHOD_CREDIT_CARD } from '../../PremiumHelper'
import CreditCardMethod from './CreditCardMethod'
import PaymentPreviewModalWrapper from '../PaymentPreviewModal/PaymentPreviewModalWrapper'

export default function PaymentMethods({
    paymentMethod,
    setPaymentMethod,
    openCompanyPreview,
    selectedUserIds,
    companyData,
}) {
    const goPreviousStep = () => {
        openCompanyPreview()
    }

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Select your preferred payment method')}</Text>
            <CreditCardMethod
                setPaymentMethod={setPaymentMethod}
                selected={paymentMethod === PAYMENT_METHOD_CREDIT_CARD}
            />
            <View style={localStyles.actions}>
                <Button
                    title={translate('Cancel')}
                    type={'secondary'}
                    buttonStyle={{ marginRight: 8 }}
                    onPress={goPreviousStep}
                />
                <PaymentPreviewModalWrapper
                    paymentMethod={paymentMethod}
                    selectedUserIds={selectedUserIds}
                    companyData={companyData}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginTop: 34,
        marginBottom: 16,
    },
    actions: {
        marginTop: 32,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
