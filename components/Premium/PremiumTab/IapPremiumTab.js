import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import { getNativePurchasesPlugin } from '../../../utils/CapacitorShell'
import {
    REVENUECAT_APPLE_API_KEY,
    IAP_PRODUCT_PREMIUM_MONTHLY,
    IAP_PRODUCT_PREMIUM_YEARLY,
    IAP_PRODUCT_GOLD_10000,
} from '../../../utils/revenueCatConfig'
import { PLAN_STATUS_PREMIUM } from '../PremiumHelper'

// RevenueCat must be configured exactly once per app launch; remember it at
// module level so tab remounts don't re-configure.
let configuredForUserId = null

const findPackageByProduct = (offering, productId) => {
    const packages = offering?.availablePackages || []
    return packages.find(p => {
        const id = p?.product?.identifier || ''
        // StoreKit ids can arrive suffixed (product:base-plan); match the base.
        return id === productId || id.split(':')[0] === productId
    })
}

export default function IapPremiumTab() {
    const loggedUser = useSelector(state => state.loggedUser)
    const premiumStatus = loggedUser.premium?.status
    const isPremium = premiumStatus === PLAN_STATUS_PREMIUM

    const [loading, setLoading] = useState(true)
    const [offering, setOffering] = useState(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [errorMessage, setErrorMessage] = useState('')

    const purchases = getNativePurchasesPlugin()
    const configured = !!purchases && !!REVENUECAT_APPLE_API_KEY

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!configured) {
                setLoading(false)
                return
            }
            try {
                if (configuredForUserId !== loggedUser.uid) {
                    await purchases.configure({ apiKey: REVENUECAT_APPLE_API_KEY, appUserID: loggedUser.uid })
                    configuredForUserId = loggedUser.uid
                }
                const result = await purchases.getOfferings()
                if (!cancelled) setOffering(result?.current || null)
            } catch (error) {
                console.error('Failed to load App Store offerings:', error)
                if (!cancelled) setErrorMessage(translate('Purchases unavailable'))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [configured, loggedUser.uid])

    const buy = async pkg => {
        if (!pkg || busy) return
        setBusy(true)
        setMessage('')
        setErrorMessage('')
        try {
            await purchases.purchasePackage({ aPackage: pkg })
            // Granting happens server-side via the RevenueCat webhook; the
            // user doc listener updates the UI when it lands.
            setMessage(translate('Purchase successful'))
        } catch (error) {
            // User cancellation is a normal outcome, not an error.
            if (!error?.userCancelled && !/cancel/i.test(error?.message || '')) {
                console.error('Purchase failed:', error)
                setErrorMessage(translate('Purchase failed'))
            }
        } finally {
            setBusy(false)
        }
    }

    const restore = async () => {
        if (busy) return
        setBusy(true)
        setMessage('')
        setErrorMessage('')
        try {
            await purchases.restorePurchases()
            setMessage(translate('Purchases restored'))
        } catch (error) {
            console.error('Restore failed:', error)
            setErrorMessage(translate('Purchase failed'))
        } finally {
            setBusy(false)
        }
    }

    const monthlyPkg = findPackageByProduct(offering, IAP_PRODUCT_PREMIUM_MONTHLY)
    const yearlyPkg = findPackageByProduct(offering, IAP_PRODUCT_PREMIUM_YEARLY)
    const goldPkg = findPackageByProduct(offering, IAP_PRODUCT_GOLD_10000)

    return (
        <View style={localStyles.container}>
            <View style={localStyles.statusCard}>
                <Icon name={'crown'} size={24} color={isPremium ? colors.UtilityYellow200 : colors.Text03} />
                <Text style={localStyles.statusText}>
                    {translate(isPremium ? 'You are on Premium' : 'You are on the Free plan')}
                </Text>
            </View>

            {!configured ? (
                <Text style={localStyles.infoText}>{translate('Purchases unavailable')}</Text>
            ) : loading ? (
                <ActivityIndicator color={colors.Primary100} style={{ marginTop: 32 }} />
            ) : (
                <>
                    {!isPremium && (
                        <View style={localStyles.section}>
                            <Text style={localStyles.sectionTitle}>{translate('Upgrade to Premium')}</Text>
                            {monthlyPkg && (
                                <Button
                                    title={`${translate('Monthly')} — ${monthlyPkg.product?.priceString || ''}`}
                                    buttonStyle={localStyles.buyButton}
                                    onPress={() => buy(monthlyPkg)}
                                    disabled={busy}
                                />
                            )}
                            {yearlyPkg && (
                                <Button
                                    title={`${translate('Yearly')} — ${yearlyPkg.product?.priceString || ''}`}
                                    buttonStyle={localStyles.buyButton}
                                    onPress={() => buy(yearlyPkg)}
                                    disabled={busy}
                                />
                            )}
                            {!monthlyPkg && !yearlyPkg && (
                                <Text style={localStyles.infoText}>{translate('Purchases unavailable')}</Text>
                            )}
                        </View>
                    )}

                    {goldPkg && (
                        <View style={localStyles.section}>
                            <Text style={localStyles.sectionTitle}>{translate('Need more Gold?')}</Text>
                            <Button
                                title={`${translate('Buy 10000 Gold')} — ${goldPkg.product?.priceString || ''}`}
                                buttonStyle={localStyles.buyButton}
                                onPress={() => buy(goldPkg)}
                                disabled={busy}
                            />
                        </View>
                    )}

                    <View style={localStyles.section}>
                        <Button
                            title={translate('Restore purchases')}
                            type={'secondary'}
                            onPress={restore}
                            disabled={busy}
                        />
                        {isPremium && (
                            <Text style={localStyles.infoText}>{translate('Manage subscription in App Store')}</Text>
                        )}
                    </View>
                </>
            )}

            {!!message && <Text style={localStyles.successText}>{message}</Text>}
            {!!errorMessage && <Text style={localStyles.errorText}>{errorMessage}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingVertical: 24,
    },
    statusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Secondary400,
        borderRadius: 8,
        padding: 16,
    },
    statusText: {
        ...styles.title6,
        color: '#ffffff',
        marginLeft: 12,
    },
    section: {
        marginTop: 32,
    },
    sectionTitle: {
        ...styles.title6,
        color: colors.Text01,
        marginBottom: 12,
    },
    buyButton: {
        alignSelf: 'flex-start',
        marginTop: 8,
    },
    infoText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 16,
    },
    successText: {
        ...styles.body2,
        color: colors.UtilityGreen200,
        marginTop: 16,
    },
    errorText: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginTop: 16,
    },
})
