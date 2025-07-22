import React, { useEffect, useState } from 'react'
import { Text, View, StyleSheet, TouchableOpacity, TextInput } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import global, { colors } from '../../styles/global'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import URLsSettings from '../../../URLSystem/Settings/URLsSettings'
import { translate } from '../../../i18n/TranslationService'
import Backend from '../../../utils/BackendBridge'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import {
    checkUserPremiumStatusStripe,
    getStripePaymentLinks,
    createStripePortalSession,
    linkStripeAccountByEmail,
} from '../../../utils/backends/Premium/stripePremiumFirestore'
import { PLAN_STATUS_PREMIUM } from '../PremiumHelper'
import { inProductionEnvironment } from '../../../utils/backends/firestore'

export default function StripePremiumTab() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isLoading, setIsLoading] = useState(false)
    const [premiumData, setPremiumData] = useState(null)
    const [showLinkingSection, setShowLinkingSection] = useState(false)
    const [linkingEmail, setLinkingEmail] = useState('')

    const isPremium = loggedUser.premium?.status === PLAN_STATUS_PREMIUM

    useEffect(() => {
        writeBrowserURL()
        checkPremiumStatus()
    }, [])

    const writeBrowserURL = () => {
        URLsSettings.push(DV_TAB_SETTINGS_PREMIUM)
    }

    const checkPremiumStatus = async () => {
        setIsLoading(true)
        try {
            const result = await checkUserPremiumStatusStripe()
            setPremiumData(result)
            if (result.success) {
                console.log('Premium status checked successfully')
                if (result.linkedViaTracking) {
                    console.log('Subscription automatically linked via tracking ID!')
                }
            }
        } catch (error) {
            console.error(translate('Error checking premium status'), error)
        } finally {
            setIsLoading(false)
        }
    }

    const handlePaymentLinkClick = type => {
        const paymentLinks = getStripePaymentLinks()
        const url = type === 'monthly' ? paymentLinks.monthly : paymentLinks.yearly

        Backend.logEvent('click_premium_payment_link', {
            userId: loggedUser.uid,
            planType: type,
        })

        // Open Stripe payment link in new tab
        window.open(url, '_blank')
    }

    const handleManageBilling = async () => {
        setIsLoading(true)
        try {
            const isProduction = inProductionEnvironment()

            // Direct Stripe billing portal URLs based on environment
            const billingUrl = isProduction
                ? 'https://billing.stripe.com/p/login/cN2aGI6ivfRDgrm3cc'
                : 'https://billing.stripe.com/p/login/test_fZu28rex8fWm1SC7ib9Zm00'

            Backend.logEvent('click_manage_billing', {
                userId: loggedUser.uid,
                environment: isProduction ? 'production' : 'test',
            })

            // Open Stripe billing portal in new tab
            window.open(billingUrl, '_blank')
        } catch (error) {
            console.error('Error opening billing portal:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleLinkAccount = async () => {
        if (!linkingEmail.trim()) {
            alert(translate('Please enter the email you used for your Stripe subscription'))
            return
        }

        setIsLoading(true)
        try {
            const result = await linkStripeAccountByEmail(linkingEmail)

            if (result.success) {
                setShowLinkingSection(false)
                setLinkingEmail('')
                // Refresh the premium status to show the updated state
                await checkPremiumStatus()
                alert(translate('Account successfully linked! Your premium subscription is now active.'))
            } else {
                // Provide detailed feedback based on what was found
                let message = result.message || translate('No active subscription found for that email.')

                if (result.hasInactiveSubscriptions) {
                    message += ` ${translate('We found previous subscriptions, but they are no longer active.')}`
                }

                if (result.totalSubscriptionsFound > 0) {
                    message += ` ${translate('Total subscriptions found: ')} ${result.totalSubscriptionsFound}`
                }

                alert(message)
            }
        } catch (error) {
            console.error('Error linking account:', error)
            alert(translate('Error linking account. Please try again or contact support.'))
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        Backend.logEvent('open_premium_tab', {
            userId: loggedUser.uid,
        })
    }, [])

    const renderPremiumStatus = () => {
        if (isPremium) {
            const subscription = premiumData?.subscription
            const nextPeriodEnd = subscription?.currentPeriodEnd
            const planInterval = subscription?.planInterval

            return (
                <View style={localStyles.statusContainer}>
                    <View style={localStyles.statusHeader}>
                        <Icon name="crown" size={24} color={colors.Primary} />
                        <Text style={localStyles.statusTitle}>{translate('Premium Active')}</Text>
                    </View>

                    {subscription && (
                        <View style={localStyles.subscriptionDetails}>
                            <Text style={localStyles.detailText}>
                                {translate('Plan')}:{' '}
                                {planInterval === 'year' ? translate('Yearly') : translate('Monthly')}
                            </Text>
                            {nextPeriodEnd && (
                                <Text style={localStyles.detailText}>
                                    {translate('Next billing')}: {new Date(nextPeriodEnd * 1000).toLocaleDateString()}
                                </Text>
                            )}
                        </View>
                    )}

                    <Text style={localStyles.statusDescription}>{translate('Premium features access')}</Text>

                    <View style={localStyles.premiumActions}>
                        <View
                            style={[localStyles.manageBillingButton, { marginRight: smallScreenNavigation ? 12 : 64 }]}
                        >
                            <Button
                                title={translate('Manage Billing')}
                                type="primary"
                                onPress={handleManageBilling}
                                loading={isLoading}
                            />
                        </View>
                        <View
                            style={[localStyles.refreshStatusButton, { marginLeft: smallScreenNavigation ? 12 : 64 }]}
                        >
                            <Button
                                title={translate('Refresh Status')}
                                type="ghost"
                                onPress={checkPremiumStatus}
                                loading={isLoading}
                            />
                        </View>
                    </View>
                </View>
            )
        }

        return (
            <View style={localStyles.upgradeContainer}>
                {/* Hero Section */}
                <View style={localStyles.heroSection}>
                    <View style={localStyles.crownContainer}>
                        <Icon name="crown" size={48} color={colors.Primary} />
                    </View>
                    <Text style={localStyles.upgradeTitle}>{translate('Upgrade to Premium')}</Text>
                    <Text style={localStyles.upgradeDescription}>{translate('Premium upgrade description')}</Text>
                </View>

                {/* Features Grid */}
                <View style={localStyles.featuresGrid}>
                    <View style={localStyles.featureCard}>
                        <View style={localStyles.featureIconContainer}>
                            <Icon name="check" size={20} color={colors.Primary} />
                        </View>
                        <Text style={localStyles.featureTitle}>{translate('Unlimited projects')}</Text>
                    </View>
                    <View style={localStyles.featureCard}>
                        <View style={localStyles.featureIconContainer}>
                            <Icon name="check" size={20} color={colors.Primary} />
                        </View>
                        <Text style={localStyles.featureTitle}>{translate('Unlimited tasks per month')}</Text>
                    </View>
                    <View style={localStyles.featureCard}>
                        <View style={localStyles.featureIconContainer}>
                            <Icon name="check" size={20} color={colors.Primary} />
                        </View>
                        <Text style={localStyles.featureTitle}>{translate('Priority support')}</Text>
                    </View>
                </View>

                {/* Pricing Section */}
                <View style={localStyles.pricingSection}>
                    <Text style={localStyles.pricingSectionTitle}>{translate('Choose your plan')}</Text>

                    <View style={localStyles.pricingContainer}>
                        <TouchableOpacity
                            style={localStyles.pricingCard}
                            onPress={() => handlePaymentLinkClick('monthly')}
                        >
                            <View style={localStyles.cardContent}>
                                <Text style={localStyles.pricingTitle}>{translate('Monthly')}</Text>
                                <View style={localStyles.priceContainer}>
                                    <Text style={localStyles.pricingPrice}>$15</Text>
                                    <Text style={localStyles.pricingPeriod}>/month</Text>
                                </View>
                            </View>
                            <View style={localStyles.buttonContainer}>
                                <Button
                                    title={translate('Subscribe Monthly')}
                                    type="primary"
                                    onPress={() => handlePaymentLinkClick('monthly')}
                                    style={localStyles.subscribeButton}
                                />
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[localStyles.pricingCard, localStyles.yearlyCard]}
                            onPress={() => handlePaymentLinkClick('yearly')}
                        >
                            <View style={localStyles.cardContent}>
                                <Text style={localStyles.pricingTitle}>{translate('Yearly')}</Text>
                                <View style={localStyles.priceContainer}>
                                    <Text style={localStyles.pricingPrice}>$99</Text>
                                    <Text style={localStyles.pricingPeriod}>/year</Text>
                                </View>
                                <View style={localStyles.savingsContainer}>
                                    <Text style={localStyles.savingsText}>{translate('Save 45%!')}</Text>
                                </View>
                            </View>
                            <View style={localStyles.buttonContainer}>
                                <Button
                                    title={translate('Subscribe Yearly')}
                                    type="primary"
                                    onPress={() => handlePaymentLinkClick('yearly')}
                                    style={localStyles.subscribeButton}
                                />
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Footer */}
                <View style={localStyles.footer}>
                    <Button
                        title={translate('Refresh Status')}
                        type="ghost"
                        onPress={checkPremiumStatus}
                        loading={isLoading}
                        style={localStyles.refreshButton}
                    />

                    {!isPremium && (
                        <View style={{ paddingTop: 20, alignItems: 'flex-start' }}>
                            <Button
                                title={
                                    showLinkingSection
                                        ? translate('Hide Manual Linking')
                                        : translate('Link Existing Subscription')
                                }
                                type="ghost"
                                onPress={() => setShowLinkingSection(!showLinkingSection)}
                                style={localStyles.refreshButton}
                            />
                        </View>
                    )}
                </View>

                {/* Manual Account Linking Section */}
                {!isPremium && showLinkingSection && (
                    <View style={localStyles.linkingSection}>
                        <View style={localStyles.linkingHeader}>
                            <Icon name="link" size={20} color={colors.Text02} />
                            <Text style={localStyles.linkingTitle}>{translate('Link Existing Subscription')}</Text>
                        </View>

                        <Text style={localStyles.linkingDescription}>
                            {translate(
                                "If you already have a subscription but it's not showing up, enter the email address you used when subscribing:"
                            )}
                        </Text>

                        <View style={localStyles.linkingForm}>
                            <TextInput
                                style={localStyles.emailInput}
                                placeholder={translate('Email used for Stripe subscription')}
                                value={linkingEmail}
                                onChangeText={setLinkingEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />

                            <Button
                                title={translate('Link Account')}
                                type="primary"
                                onPress={handleLinkAccount}
                                loading={isLoading}
                                style={localStyles.linkButton}
                            />
                        </View>
                    </View>
                )}
            </View>
        )
    }

    return (
        <View style={{ marginBottom: 56 }}>
            <Text style={localStyles.headerText}>{translate('Premium')}</Text>
            {renderPremiumStatus()}
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerText: {
        ...global.title6,
        marginTop: 32,
        marginBottom: 12,
    },
    statusContainer: {
        backgroundColor: colors.Surface,
        borderRadius: 16,
        padding: 32,
        marginBottom: 24,
        borderWidth: 2,
        borderColor: colors.Primary,
        shadowColor: colors.Primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    statusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    statusTitle: {
        ...global.title6,
        color: colors.Primary,
        marginLeft: 12,
    },
    subscriptionDetails: {
        marginBottom: 16,
    },
    detailText: {
        ...global.body2,
        color: colors.Text02,
        marginBottom: 4,
    },
    statusDescription: {
        ...global.body1,
        color: colors.Text02,
    },
    upgradeContainer: {
        backgroundColor: colors.Surface,
        borderRadius: 16,
        padding: 0,
        marginBottom: 24,
        shadowColor: colors.Text03,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    heroSection: {
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 40,
        backgroundColor: `${colors.Primary}10`,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    crownContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: `${colors.Primary}20`,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    upgradeTitle: {
        ...global.title4,
        color: colors.Text01,
        marginBottom: 12,
        textAlign: 'center',
    },
    upgradeDescription: {
        ...global.body1,
        color: colors.Text02,
        textAlign: 'center',
        lineHeight: 24,
    },
    featuresGrid: {
        padding: 32,
        gap: 16,
    },
    featureCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    featureIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: `${colors.Primary}15`,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    featureTitle: {
        ...global.body1,
        color: colors.Text01,
        fontWeight: '500',
        flex: 1,
    },
    pricingSection: {
        padding: 32,
        paddingTop: 0,
    },
    pricingSectionTitle: {
        ...global.title6,
        color: colors.Text01,
        textAlign: 'center',
        marginBottom: 24,
    },
    pricingContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    pricingCard: {
        flex: 1,
        backgroundColor: colors.Background,
        borderRadius: 16,
        padding: 28,
        borderWidth: 1,
        borderColor: colors.Text03,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 12,
        minHeight: 280,
    },
    yearlyCard: {
        borderColor: colors.Text03,
        backgroundColor: `${colors.Primary}05`,
    },
    popularBadge: {
        position: 'absolute',
        top: -10,
        alignSelf: 'center',
        backgroundColor: colors.Primary,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
        shadowColor: colors.Primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 4,
        zIndex: 1,
    },
    popularText: {
        ...global.caption,
        color: colors.Surface,
        fontWeight: '700',
        fontSize: 12,
    },
    pricingTitle: {
        ...global.title6,
        color: colors.Text01,
        textAlign: 'center',
        marginBottom: 12,
        marginTop: 4,
    },
    priceContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'center',
        marginBottom: 8,
    },
    pricingPrice: {
        ...global.title3,
        color: colors.Primary,
        fontWeight: '700',
    },
    pricingPeriod: {
        ...global.body2,
        color: colors.Text02,
        marginLeft: 4,
    },
    savingsContainer: {
        backgroundColor: `${colors.Primary}15`,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        marginBottom: 16,
    },
    savingsText: {
        ...global.caption,
        color: colors.Primary,
        textAlign: 'center',
        fontWeight: '600',
    },
    cardContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonContainer: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 20,
        flexDirection: 'row',
    },
    subscribeButton: {
        flex: 0,
        alignSelf: 'center',
    },
    footer: {
        padding: 32,
        paddingTop: 0,
        alignItems: 'flex-start',
    },
    refreshButton: {
        marginTop: 0,
    },
    premiumActions: {
        flexDirection: 'row',
        marginTop: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    manageBillingButton: {
        // Dynamic margin applied inline based on screen size
    },
    refreshStatusButton: {
        // Dynamic margin applied inline based on screen size
    },
    linkingSection: {
        backgroundColor: colors.Surface,
        borderRadius: 16,
        padding: 32,
        marginTop: 24,
        borderWidth: 1,
        borderColor: colors.Text03,
        shadowColor: colors.Text03,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    linkingHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    linkingTitle: {
        ...global.title6,
        color: colors.Text01,
        marginLeft: 12,
    },
    linkingDescription: {
        ...global.body1,
        color: colors.Text02,
        marginBottom: 24,
        textAlign: 'center',
    },
    linkingForm: {
        marginBottom: 24,
    },
    emailInput: {
        ...global.body1,
        color: colors.Text01,
        backgroundColor: colors.Background,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: colors.Text03,
        marginBottom: 16,
    },
    linkButton: {
        flex: 0,
        alignSelf: 'center',
    },
    linkingNote: {
        ...global.caption,
        color: colors.Text02,
        textAlign: 'center',
        marginTop: 16,
    },
})
