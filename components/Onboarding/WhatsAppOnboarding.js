import React, { useState, useRef, useEffect } from 'react'
import {
    StyleSheet,
    Text,
    View,
    TextInput,
    Dimensions,
    TouchableOpacity,
    Image,
    ActivityIndicator,
    Animated,
} from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { firebase } from '@firebase/app'

import styles from '../styles/global'
import Colors from '../../Themes/Colors'
import { translate } from '../../i18n/TranslationService'
import { validatePhoneNumber } from '../../utils/phoneValidation'
import { setUserPhone, setUserReceiveWhatsApp } from '../../utils/backends/Users/usersFirestore'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import Icon from '../Icon'
import SplitLayout from './SplitLayout'
import { startServerSideAuth } from '../../apis/google/GoogleOAuthServerSide'
import { requestNotificationPermission, logEvent } from '../../utils/backends/firestore'
import { setUserReceivePushNotifications } from '../../utils/backends/Users/usersFirestore'
import { disableMorningReminderTask } from '../../utils/backends/Tasks/tasksFirestore'

const ProgressBar = ({ current, total }) => {
    const progress = useRef(new Animated.Value(0)).current

    useEffect(() => {
        Animated.timing(progress, {
            toValue: (current + 1) / total,
            duration: 500,
            useNativeDriver: false,
        }).start()
    }, [current, total])

    const width = progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    })

    return (
        <View style={localStyles.progressBarWrapper}>
            <View style={localStyles.progressBarContainer}>
                <Animated.View style={[localStyles.progressBarFill, { width }]} />
            </View>
            <Text style={localStyles.progressText}>
                Step {current + 1} of {total}
            </Text>
        </View>
    )
}

export default function WhatsAppOnboarding({ navigation }) {
    const [phone, setPhone] = useState('')
    const [validationError, setValidationError] = useState('')
    const [saving, setSaving] = useState(false)
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)
    const phoneInputRef = useRef()
    const loggedUser = useSelector(state => state.loggedUser)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const firstProjectId = useSelector(state =>
        state.loggedUserProjects && state.loggedUserProjects.length > 0 ? state.loggedUserProjects[0].id : null
    )
    const projectId = defaultProjectId || firstProjectId

    const nextUrl = navigation.getParam('nextUrl', '/')
    const isDesktop = windowWidth > 768
    const isMobile = !isDesktop

    const titleStyle = [localStyles.title, isMobile && { fontSize: 28 }]

    const [step, setStep] = useState(0) // 0: WhatsApp, 1: Calendar, 2: Gmail, 3: MorningReminder, 4: Push
    const [connectingService, setConnectingService] = useState(null)
    const [showSuccess, setShowSuccess] = useState(null)
    const blinkAnim = useRef(new Animated.Value(1)).current

    const startBlinking = () => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(blinkAnim, {
                    toValue: 0.5,
                    duration: 500,
                    useNativeDriver: true,
                }),
                Animated.timing(blinkAnim, {
                    toValue: 1,
                    duration: 500,
                    useNativeDriver: true,
                }),
            ])
        ).start()
    }

    useEffect(() => {
        const updateDimensions = () => {
            setWindowWidth(Dimensions.get('window').width)
        }
        Dimensions.addEventListener('change', updateDimensions)
        return () => {
            Dimensions.removeEventListener('change', updateDimensions)
        }
    }, [])

    const handleContinue = async () => {
        if (saving) return

        // If phone is empty, just proceed (treat as skip)
        // If phone is empty, just proceed (treat as skip)
        if (!phone || phone.trim() === '') {
            setStep(1)
            return
        }

        const validation = validatePhoneNumber(phone)

        if (!validation.isValid) {
            setValidationError(translate(validation.error) || validation.error || 'Invalid phone number')
            return
        }

        setSaving(true)
        try {
            await setUserPhone(loggedUser.uid, validation.formatted)
            await setUserReceiveWhatsApp(loggedUser.uid, true)

            // Automatically generate MCP access token for this user
            try {
                // Ensure auth is loaded
                if (firebase.auth) {
                    const currentUser = firebase.auth().currentUser
                    if (currentUser) {
                        const idToken = await currentUser.getIdToken()
                        // Use relative path which works for Web, simple fetch to the backend function
                        // We use the same endpoint that the direct login page uses
                        console.log('Generating MCP token for WhatsApp user...')
                        await fetch('/mcpServer/get-token', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                firebaseToken: idToken,
                                email: currentUser.email,
                            }),
                        })
                        console.log('MCP token generation request sent')
                    }
                }
            } catch (tokenError) {
                // We don't block the user flow if token generation fails, just log it
                console.warn('Failed to auto-generate MCP token:', tokenError)
            }

            setStep(1)
            logEvent('onboarding_whatsapp_connected')
        } catch (error) {
            console.error('Error saving phone:', error)
            setValidationError('Failed to save phone number. Please try again.')
            setSaving(false)
        }
    }

    const handleSkip = () => {
        logEvent('onboarding_whatsapp_skipped')
        setStep(1)
    }

    const proceed = () => {
        URLTrigger.processUrl(NavigationService, nextUrl)
    }

    const onPhoneChange = newPhone => {
        setPhone(newPhone)
        if (validationError) {
            setValidationError('')
        }
    }

    const renderLogo = () => (
        <View style={localStyles.logoContainer}>
            <Icon size={32} name={'logo'} color={Colors.Primary100} />
            <Icon style={{ marginLeft: 12 }} size={32} name={'logo-name'} color={Colors.Primary100} />
        </View>
    )

    const connectService = async service => {
        setConnectingService(service)
        try {
            await startServerSideAuth(projectId, service)
            setConnectingService(null)
            setShowSuccess(service)
            startBlinking()
            // Auto advance
            setTimeout(() => {
                setShowSuccess(null)
                blinkAnim.setValue(1) // Reset animation
                if (service === 'calendar') {
                    logEvent('onboarding_calendar_connected')
                    setStep(2)
                } else {
                    logEvent('onboarding_gmail_connected')
                    setStep(3)
                }
            }, 2000)
        } catch (error) {
            console.error('Connection failed', error)
            setConnectingService(null)
        }
    }

    const enablePushNotifications = async () => {
        try {
            const result = await requestNotificationPermission()
            if (result.success) {
                await setUserReceivePushNotifications(loggedUser.uid, true)
                logEvent('onboarding_push_enabled')
            } else {
                logEvent('onboarding_push_skipped')
            }
        } catch (error) {
            console.error('Error enabling push notifications:', error)
        }
        proceed()
    }

    const handleMorningReminder = async enabled => {
        if (!enabled) {
            try {
                // If user disabled, find the Daily Focus Task and set recurrence to never
                await disableMorningReminderTask(projectId)
            } catch (error) {
                console.error('Error disabling morning reminder:', error)
            }
            logEvent('onboarding_morning_reminder_skipped')
        } else {
            logEvent('onboarding_morning_reminder_enabled')
        }
        setStep(4)
    }

    const renderWhatsAppStep = () => (
        <View style={localStyles.contentContainer}>
            <Image
                source={require('../../assets/whatsapp.png')}
                style={{ width: 64, height: 64, marginBottom: 24 }}
                resizeMode="contain"
            />
            <Text style={titleStyle}>{translate("What's your WhatsApp number?")}</Text>
            <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24 }]}>Let's chat over there as well</Text>

            <View style={localStyles.inputContainer}>
                <TextInput
                    ref={phoneInputRef}
                    style={localStyles.phoneInput}
                    value={phone}
                    placeholder="Type your phone number"
                    placeholderTextColor={Colors.Text03}
                    onChangeText={onPhoneChange}
                    keyboardType="phone-pad"
                    autoFocus={false}
                    onSubmitEditing={handleContinue}
                />
                {validationError ? <Text style={localStyles.errorText}>{validationError}</Text> : null}
            </View>

            <View style={localStyles.actions}>
                <TouchableOpacity style={localStyles.primaryButton} onPress={handleContinue}>
                    <Text style={localStyles.primaryButtonText}>{saving ? 'Saving...' : 'Save & Continue'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={localStyles.secondaryButton} onPress={handleSkip}>
                    <Text style={localStyles.secondaryButtonText}>No thank you</Text>
                </TouchableOpacity>
            </View>
        </View>
    )

    const renderCalendarConnection = () => {
        const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity)
        return (
            <View style={localStyles.contentContainer}>
                <Icon name="calendar" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
                <Text style={titleStyle}>{translate('Connect Google Calendar')}</Text>
                <Text style={localStyles.subtitle}>{translate('onboarding_connect_calendar_desc')}</Text>
                <AnimatedTouchableOpacity
                    style={[
                        localStyles.primaryButton,
                        connectingService === 'calendar' && { opacity: 0.7 },
                        showSuccess === 'calendar' && { backgroundColor: Colors.UtilityGreen300, opacity: blinkAnim },
                    ]}
                    onPress={() => connectService('calendar')}
                    disabled={connectingService === 'calendar' || showSuccess === 'calendar'}
                >
                    {connectingService === 'calendar' ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIndicator color="#FFF" size="small" style={{ marginRight: 8 }} />
                            <Text style={localStyles.primaryButtonText}>{translate('working_on_it')}</Text>
                        </View>
                    ) : showSuccess === 'calendar' ? (
                        <Text style={localStyles.primaryButtonText}>{translate('Connected!')}</Text>
                    ) : (
                        <Text style={localStyles.primaryButtonText}>{translate('Connect Calendar')}</Text>
                    )}
                </AnimatedTouchableOpacity>
                <TouchableOpacity
                    style={localStyles.secondaryButton}
                    onPress={() => {
                        logEvent('onboarding_calendar_skipped')
                        setStep(2)
                    }}
                    disabled={connectingService === 'calendar'}
                >
                    <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const renderGmailConnection = () => {
        const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity)
        return (
            <View style={localStyles.contentContainer}>
                <Icon name="gmail" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
                <Text style={titleStyle}>{translate('Connect Gmail')}</Text>
                <Text style={localStyles.subtitle}>{translate('onboarding_connect_gmail_desc')}</Text>
                <AnimatedTouchableOpacity
                    style={[
                        localStyles.primaryButton,
                        connectingService === 'gmail' && { opacity: 0.7 },
                        showSuccess === 'gmail' && { backgroundColor: Colors.UtilityGreen300, opacity: blinkAnim },
                    ]}
                    onPress={() => connectService('gmail')}
                    disabled={connectingService === 'gmail' || showSuccess === 'gmail'}
                >
                    {connectingService === 'gmail' ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIndicator color="#FFF" size="small" style={{ marginRight: 8 }} />
                            <Text style={localStyles.primaryButtonText}>{translate('working_on_it')}</Text>
                        </View>
                    ) : showSuccess === 'gmail' ? (
                        <Text style={localStyles.primaryButtonText}>{translate('Connected!')}</Text>
                    ) : (
                        <Text style={localStyles.primaryButtonText}>{translate('Connect Gmail')}</Text>
                    )}
                </AnimatedTouchableOpacity>
                <TouchableOpacity
                    style={localStyles.secondaryButton}
                    onPress={() => {
                        logEvent('onboarding_gmail_skipped')
                        setStep(3)
                    }}
                    disabled={connectingService === 'gmail'}
                >
                    <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const renderMorningReminderStep = () => (
        <View style={localStyles.contentContainer}>
            <Icon name="bell" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
            <Text style={titleStyle}>{translate('Morning Tasks Reminder')}</Text>
            <Text style={localStyles.subtitle}>{translate('onboarding_morning_reminder_desc')}</Text>
            <TouchableOpacity style={localStyles.primaryButton} onPress={() => handleMorningReminder(true)}>
                <Text style={localStyles.primaryButtonText}>{translate('Enable')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.secondaryButton} onPress={() => handleMorningReminder(false)}>
                <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    const renderPushNotificationStep = () => (
        <View style={localStyles.contentContainer}>
            <Icon name="bell" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
            <Text style={titleStyle}>{translate('Enable Push Notifications')}</Text>
            <Text style={localStyles.subtitle}>{translate('onboarding_enable_push_desc')}</Text>
            <TouchableOpacity style={localStyles.primaryButton} onPress={enablePushNotifications}>
                <Text style={localStyles.primaryButtonText}>{translate('Enable')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={localStyles.secondaryButton}
                onPress={() => {
                    logEvent('onboarding_push_skipped')
                    proceed()
                }}
            >
                <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    return (
        <SplitLayout>
            <ProgressBar current={step} total={5} />
            {step === 0 && renderWhatsAppStep()}
            {step === 1 && renderCalendarConnection()}
            {step === 2 && renderGmailConnection()}
            {step === 3 && renderMorningReminderStep()}
            {step === 4 && renderPushNotificationStep()}
        </SplitLayout>
    )
}

const localStyles = StyleSheet.create({
    contentContainer: {
        width: '100%',
        maxWidth: 480,
        alignItems: 'center',
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 48,
        flexWrap: 'nowrap',
        justifyContent: 'center',
        width: '100%',
    },
    title: {
        ...styles.title2,
        textAlign: 'center',
        marginBottom: 16,
        color: Colors.Text01,
    },
    subtitle: {
        ...styles.body1,
        textAlign: 'center',
        marginBottom: 48,
        color: Colors.Text02,
        maxWidth: 400,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 32,
    },
    label: {
        ...styles.subtitle2,
        marginBottom: 8,
        color: Colors.Text02,
    },
    phoneInput: {
        ...styles.body1,
        color: Colors.Text01,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderWidth: 2,
        borderColor: Colors.Grey300,
        borderRadius: 8,
        backgroundColor: Colors.White,
        height: 48,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    errorText: {
        ...styles.caption2,
        color: Colors.UtilityRed200,
        marginTop: 4,
    },
    actions: {
        width: '100%',
        alignItems: 'center',
        // gap: 16, // not supported in RN
    },
    primaryButton: {
        backgroundColor: Colors.Primary100,
        paddingVertical: 20,
        paddingHorizontal: 48,
        borderRadius: 16,
        width: '100%',
        alignItems: 'center',
        marginBottom: 16,
        shadowColor: Colors.Primary100,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.2,
        shadowRadius: 16,
        elevation: 8,
    },
    primaryButtonText: {
        color: Colors.White,
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    secondaryButton: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center',
    },
    secondaryButtonText: {
        color: Colors.Text02,
        fontSize: 16,
        fontWeight: '500',
    },
    progressBarWrapper: {
        width: '100%',
        maxWidth: 480,
        marginBottom: 32,
        alignItems: 'center',
    },
    progressBarContainer: {
        width: '100%',
        height: 8,
        backgroundColor: Colors.Grey200,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 8,
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: Colors.Primary100,
        borderRadius: 4,
    },
    progressText: {
        ...styles.caption1,
        color: Colors.Text03,
    },
})
