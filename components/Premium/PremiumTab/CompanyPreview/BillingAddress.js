import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import CompanyAddressModalWrapper from '../CompanyAddressModal/CompanyAddressModalWrapper'
import Address from './Address'

export default function BillingAddress({ usePersistentSave, companyData, setCompanyData, subscription }) {
    return (
        <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.subtitle1}>{translate('Billing address')}</Text>
                <Icon name={'info'} size={16} color={colors.Text03} style={{ marginLeft: 10.67, marginRight: 4.67 }} />
                <Text style={[styles.body2, { color: colors.Text03 }]}>{translate('Optional')}</Text>
            </View>
            <Address companyData={companyData} />
            <CompanyAddressModalWrapper
                usePersistentSave={usePersistentSave}
                companyData={companyData}
                setCompanyData={setCompanyData}
                subscription={subscription}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    info: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: 48,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    billingAddress: {
        ...styles.body1,
        color: colors.Text01,
        marginVertical: 8,
    },
})
