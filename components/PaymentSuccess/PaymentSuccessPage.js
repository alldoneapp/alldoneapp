import React, { useEffect, useState } from 'react'
import { StyleSheet, View, ImageBackground, Image, Text, ScrollView, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles from '../styles/global'
import URLSystem, { URL_PAYMENT_SUCCESS } from '../../URLSystem/URLSystem'
import Colors from '../../Themes/Colors'
import { useDispatch } from 'react-redux'
import { setNavigationRoute } from '../../redux/actions'
import { logEvent } from '../../utils/backends/firestore'

export default function PaymentSuccessPage() {
    const dispatch = useDispatch()
    const [countdown, setCountdown] = useState(5)

    const redirectToRoot = () => {
        window.location.href = '/'
    }

    const writeBrowserURL = () => {
        URLSystem.push(URL_PAYMENT_SUCCESS)
    }

    // Track conversion for free trial users
    const trackTrialConversion = (trackingId, planType) => {
        try {
            // Track the conversion event in Google Analytics with the specific measurement ID
            if (typeof gtag !== 'undefined') {
                // Send conversion event to the specific Google Analytics property
                gtag('config', 'G-GNT2NCRH9K', {
                    send_page_view: false,
                })

                gtag('event', 'conversion', {
                    send_to: 'G-GNT2NCRH9K',
                    event_category: 'trial_conversion',
                    event_label: planType || 'unknown',
                    value: planType === 'yearly' ? 1 : 0.5, // Higher value for yearly plans
                    custom_parameters: {
                        trial_tracking_id: trackingId?.substring(0, 20), // Truncated for privacy
                        plan_type: planType,
                        source: 'stripe_trial',
                    },
                })

                console.log('📊 Google Analytics conversion tracked:', {
                    measurement_id: 'G-GNT2NCRH9K',
                    event: 'conversion',
                    plan_type: planType,
                    tracking_id_preview: trackingId?.substring(0, 20) + '...',
                })
            }

            // Also track using Firebase Analytics for additional reporting
            logEvent('trial_conversion_completed', {
                plan_type: planType || 'monthly',
                source: 'stripe',
                tracking_id: trackingId?.substring(0, 20), // Truncated for privacy
                conversion_source: 'payment_success_page',
            })

            console.log('🎯 Trial conversion tracking completed for plan:', planType)
        } catch (error) {
            console.error('Error tracking trial conversion:', error)
        }
    }

    useEffect(() => {
        writeBrowserURL()
        dispatch(setNavigationRoute('PaymentSuccess'))

        // Debug: Check if tracking ID is still present after payment
        const trackingId = localStorage.getItem('alldone_trial_tracking_id')
        const timestamp = localStorage.getItem('alldone_trial_timestamp')
        const planType = localStorage.getItem('alldone_trial_plan_type')

        console.log('🎉 Payment Success Page - Tracking ID status:', {
            trackingId: trackingId ? `${trackingId.substring(0, 20)}...` : null,
            timestamp,
            planType,
            age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60))} minutes` : null,
            redirectingIn: '5 seconds',
        })

        // Track conversion if this is a trial user
        if (trackingId && timestamp && planType) {
            console.log('🎯 Trial user detected - tracking conversion to Google Analytics')
            trackTrialConversion(trackingId, planType)
        } else {
            console.log('ℹ️ No trial tracking data found - this may not be a trial conversion')
        }

        // Start countdown timer
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer)
                    console.log('🔄 Redirecting to root - tracking ID should still be in localStorage')
                    redirectToRoot()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(timer)
    }, [])

    return (
        <ImageBackground source={require('../../web/images/illustrations/LoginBg.svg')} style={localStyles.container}>
            <ScrollView showsVerticalScrollIndicator={false} style={localStyles.scrollContainer}>
                <View style={localStyles.scrollSubContainer}>
                    <a href="/" style={{ top: 64, textDecoration: 'none' }}>
                        <View style={{ flex: 1, flexDirection: 'row' }}>
                            <Icon size={24} name={'logo'} color={Colors.Primary100} />
                            <Icon style={localStyles.logoText} size={24} name={'logo-name'} color={Colors.Primary100} />
                        </View>
                    </a>

                    <Image
                        source={{ uri: require(`../../web/images/illustrations/PersonajeEnseñando.png`) }}
                        style={{ width: 362 * 0.75, height: 470 * 0.75 }}
                        width={362}
                        height={470}
                    />

                    <Text style={localStyles.title}>Success!{'\n'}You are now being forwarded. Thank you.</Text>

                    <Text style={localStyles.countdown}>Redirecting in {countdown} seconds...</Text>

                    <TouchableOpacity style={localStyles.continueButton} onPress={redirectToRoot}>
                        <Text style={localStyles.continueButtonText}>Continue</Text>
                    </TouchableOpacity>

                    <Text style={localStyles.subtitle}>You will be redirected shortly.</Text>
                </View>
            </ScrollView>
        </ImageBackground>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrollContainer: {
        flex: 1,
        width: '100%',
    },
    scrollSubContainer: {
        flex: 1,
        paddingTop: 64,
        paddingBottom: 32,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        ...styles.title4,
        textAlign: 'center',
        color: Colors.Text02,
        padding: 16,
        maxWidth: 572,
    },
    countdown: {
        ...styles.body1,
        textAlign: 'center',
        color: Colors.Text01,
        marginBottom: 24,
        fontSize: 16,
    },
    continueButton: {
        backgroundColor: Colors.Primary100,
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 8,
        marginBottom: 16,
    },
    continueButtonText: {
        color: Colors.White,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    subtitle: {
        ...styles.body1,
        textAlign: 'center',
        color: Colors.Text01,
        paddingTop: 16,
        paddingBottom: 16,
        maxWidth: 548,
        paddingHorizontal: 16,
    },
    logoText: {
        marginLeft: 9,
    },
})
