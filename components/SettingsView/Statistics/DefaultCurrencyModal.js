import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import CloseButton from '../../FollowUp/CloseButton'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Icon from '../../Icon'
import { updateUserDefaultCurrency } from '../../../utils/backends/Users/usersFirestore'

const CURRENCIES = ['EUR', 'USD', 'GBP']

const DefaultCurrencyModal = ({ userId, currentCurrency, hidePopover }) => {
    const onSelectCurrency = currency => {
        updateUserDefaultCurrency(userId, currency)
        hidePopover()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <Text style={localStyles.title}>{translate('Select default currency')}</Text>
                    <Text style={localStyles.description}>
                        {translate('This currency will be used for displaying total earnings across all projects')}
                    </Text>
                </View>

                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    {CURRENCIES.map(currency => {
                        const selected = currency === currentCurrency

                        return (
                            <TouchableOpacity
                                key={currency}
                                style={localStyles.currencyContainer}
                                onPress={() => onSelectCurrency(currency)}
                                accessible={false}
                            >
                                <Text style={[styles.subtitle1, { color: 'white' }]}>{currency}</Text>
                                <View style={localStyles.checkIcon}>
                                    {selected && <Icon name="check" size={24} color="white" />}
                                </View>
                            </TouchableOpacity>
                        )
                    })}
                </View>
            </View>
            <CloseButton close={hidePopover} />
        </View>
    )
}

export default DefaultCurrencyModal

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    heading: {
        flexDirection: 'column',
        paddingLeft: 16,
        paddingTop: 16,
        paddingRight: 16,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
    currencyContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    checkIcon: {
        flexDirection: 'row',
        position: 'absolute',
        right: 0,
    },
})
