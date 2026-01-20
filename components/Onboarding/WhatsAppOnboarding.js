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
import { COUNTRY_CODES, DEFAULT_COUNTRY } from '../../utils/CountryCodes'

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
    const [selectedCountry, setSelectedCountry] = useState(DEFAULT_COUNTRY || COUNTRY_CODES[0])
    const [showCountryPicker, setShowCountryPicker] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [saving, setSaving] = useState(false)
    const [showWhatsAppSuccess, setShowWhatsAppSuccess] = useState(false)
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

    const titleStyle = [localStyles.title, isMobile && { fontSize: 24, marginBottom: 8 }]

    const [step, setStep] = useState(0) // 0: WhatsApp, 1: Calendar, 2: MorningReminder, 3: Push (Gmail step disabled)
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

    useEffect(() => {
        // Check for Google Auth redirect parameters
        const params = new URLSearchParams(window.location.search)
        if (params.get('googleAuth') === 'success') {
            const service = params.get('service')

            // Set initial step based on service to show success message in the right context
            if (service === 'calendar') {
                setStep(1)
                setShowSuccess('calendar')
            }
            // Gmail step is disabled, but handle redirect gracefully if it happens
            // else if (service === 'gmail') {
            //     setStep(2)
            //     setShowSuccess('gmail')
            // }

            startBlinking()

            // Clean up URL
            const url = new URL(window.location.href)
            url.searchParams.delete('googleAuth')
            url.searchParams.delete('service')
            window.history.replaceState({}, '', url.toString())

            // Auto advance
            setTimeout(() => {
                setShowSuccess(null)
                blinkAnim.setValue(1) // Reset animation
                if (service === 'calendar') {
                    logEvent('onboarding_calendar_connected')
                    setStep(2) // Skip Gmail, go to MorningReminder
                }
                // Gmail step is disabled
                // else {
                //     logEvent('onboarding_gmail_connected')
                //     setStep(3)
                // }
            }, 2000)
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

        // Combine country code and phone
        // Remove leading 0s and non-digits from the user input first to rely on the country code
        let cleanInput = phone.replace(/\D/g, '')
        // If user pasted a full number with country code (e.g. 49179...), we might want to be smart.
        // But the requested UI is explicit picker + local number.
        // Let's assume standard behavior: Picker Code + Input (stripping leading 0s)
        cleanInput = cleanInput.replace(/^0+/, '')

        const fullPhone = `+${selectedCountry.dialCode}${cleanInput}`
        const validation = validatePhoneNumber(fullPhone)

        if (!validation.isValid) {
            setValidationError(translate(validation.error) || validation.error || 'Invalid phone number')
            return
        }

        setSaving(true)
        try {
            await setUserPhone(loggedUser.uid, validation.formatted)
            await setUserReceiveWhatsApp(loggedUser.uid, true)

            setShowWhatsAppSuccess(true)
            setSaving(false)

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

            logEvent('onboarding_whatsapp_connected')
            setTimeout(() => {
                setShowWhatsAppSuccess(false)
                setStep(1)
            }, 5000)
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
        <View style={[localStyles.logoContainer, isMobile && { marginBottom: 16 }]}>
            <Icon size={isMobile ? 24 : 32} name={'logo'} color={Colors.Primary100} />
            <Icon
                style={{ marginLeft: isMobile ? 8 : 12 }}
                size={isMobile ? 24 : 32}
                name={'logo-name'}
                color={Colors.Primary100}
            />
        </View>
    )

    const connectService = async service => {
        setConnectingService(service)
        try {
            // Construct return URL for same-window redirect
            const returnUrl = new URL(window.location.href)
            returnUrl.searchParams.set('googleAuth', 'success')
            returnUrl.searchParams.set('service', service)

            await startServerSideAuth(projectId, service, returnUrl.toString())

            // If we are redirecting, the code below won't execute immediately (or at all)
            // But if we are in popup mode (fallback), it continues here

            setConnectingService(null)
            setShowSuccess(service)
            startBlinking()
            // Auto advance
            setTimeout(() => {
                setShowSuccess(null)
                blinkAnim.setValue(1) // Reset animation
                if (service === 'calendar') {
                    logEvent('onboarding_calendar_connected')
                    setStep(2) // Skip Gmail, go to MorningReminder
                }
                // Gmail step is disabled
                // else {
                //     logEvent('onboarding_gmail_connected')
                //     setStep(3)
                // }
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
        setStep(3) // Go to Push notifications step
    }

    const renderCountryPickerModal = () => {
        if (!showCountryPicker) return null

        return (
            <View style={localStyles.modalOverlay}>
                <View style={localStyles.modalContent}>
                    <View style={localStyles.modalHeader}>
                        <Text style={localStyles.modalTitle}>{translate('Select Country')}</Text>
                        <TouchableOpacity
                            onPress={() => setShowCountryPicker(false)}
                            style={localStyles.modalCloseButton}
                        >
                            <Icon name="x" size={24} color={Colors.Text02} />
                        </TouchableOpacity>
                    </View>
                    <Animated.ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                        {COUNTRY_CODES.map(country => (
                            <TouchableOpacity
                                key={country.code}
                                style={localStyles.countryItem}
                                onPress={() => {
                                    setSelectedCountry(country)
                                    setShowCountryPicker(false)
                                }}
                            >
                                <Text style={localStyles.countryItemText}>
                                    <Text style={{ fontSize: 24 }}>{country.flag}</Text> {country.name} (+
                                    {country.dialCode})
                                </Text>
                                {selectedCountry.code === country.code && (
                                    <Icon name="check" size={20} color={Colors.Primary100} />
                                )}
                            </TouchableOpacity>
                        ))}
                    </Animated.ScrollView>
                </View>
            </View>
        )
    }

    const renderWhatsAppStep = () => {
        if (showWhatsAppSuccess) {
            return (
                <View style={localStyles.contentContainer}>
                    <Image
                        source={require('../../assets/whatsapp.png')}
                        style={{
                            width: isMobile ? 64 : 80,
                            height: isMobile ? 64 : 80,
                            marginBottom: isMobile ? 16 : 24,
                        }}
                        resizeMode="contain"
                    />
                    <Icon
                        name="check"
                        size={isMobile ? 48 : 64}
                        color={Colors.UtilityGreen300}
                        style={{ marginBottom: 16 }}
                    />
                    <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>
                        {translate('onboarding_whatsapp_success_title')}
                    </Text>
                    <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                        {translate('onboarding_whatsapp_success_desc')}
                    </Text>
                </View>
            )
        }

        return (
            <View style={localStyles.contentContainer}>
                <Image
                    source={require('../../assets/whatsapp.png')}
                    style={{
                        width: isMobile ? 48 : 64,
                        height: isMobile ? 48 : 64,
                        marginBottom: isMobile ? 12 : 24,
                    }}
                    resizeMode="contain"
                />
                <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>
                    {translate("What's your WhatsApp number?")}
                </Text>
                <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                    {translate('Please enter your whatsapp number including your country code')}
                </Text>

                <View style={[localStyles.inputContainer, isMobile && { marginBottom: 16 }]}>
                    <View style={localStyles.phoneInputWrapper}>
                        <TouchableOpacity
                            style={localStyles.countryPickerTrigger}
                            onPress={() => setShowCountryPicker(true)}
                        >
                            <Text style={{ fontSize: 24 }}>{selectedCountry.flag}</Text>
                            <Text style={localStyles.dialCode}>+{selectedCountry.dialCode}</Text>
                            <Icon name="chevron-down" size={16} color={Colors.Text02} />
                        </TouchableOpacity>
                        <TextInput
                            ref={phoneInputRef}
                            style={localStyles.phoneInput}
                            value={phone}
                            placeholder="123456789"
                            placeholderTextColor={Colors.Text03}
                            onChangeText={onPhoneChange}
                            keyboardType="phone-pad"
                            autoFocus={false}
                            onSubmitEditing={handleContinue}
                        />
                    </View>
                    {validationError ? <Text style={localStyles.errorText}>{validationError}</Text> : null}
                </View>

                <View style={localStyles.actions}>
                    <TouchableOpacity
                        style={[localStyles.primaryButton, isMobile && { paddingVertical: 10, marginBottom: 10 }]}
                        onPress={handleContinue}
                    >
                        <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                            {saving ? 'Saving...' : 'Save & Continue'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[localStyles.secondaryButton, isMobile && { paddingVertical: 8 }]}
                        onPress={handleSkip}
                    >
                        <Text style={[localStyles.secondaryButtonText, isMobile && { fontSize: 14 }]}>
                            No thank you
                        </Text>
                    </TouchableOpacity>
                </View>

                {renderCountryPickerModal()}
            </View>
        )
    }

    const renderCalendarConnection = () => {
        const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity)
        return (
            <View style={localStyles.contentContainer}>
                <Icon
                    name="calendar"
                    size={isMobile ? 48 : 64}
                    color={Colors.Primary100}
                    style={{ marginBottom: isMobile ? 16 : 24 }}
                />
                <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>
                    {translate('Connect Google Calendar')}
                </Text>
                <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                    {translate('onboarding_connect_calendar_desc')}
                </Text>
                <AnimatedTouchableOpacity
                    style={[
                        localStyles.primaryButton,
                        isMobile && { paddingVertical: 10, marginBottom: 10 },
                        connectingService === 'calendar' && { opacity: 0.7 },
                        showSuccess === 'calendar' && { backgroundColor: Colors.UtilityGreen300, opacity: blinkAnim },
                    ]}
                    onPress={() => connectService('calendar')}
                    disabled={connectingService === 'calendar' || showSuccess === 'calendar'}
                >
                    {connectingService === 'calendar' ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIndicator color="#FFF" size="small" style={{ marginRight: 8 }} />
                            <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                                {translate('working_on_it')}
                            </Text>
                        </View>
                    ) : showSuccess === 'calendar' ? (
                        <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                            {translate('Connected!')}
                        </Text>
                    ) : (
                        <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                            {translate('Connect Calendar')}
                        </Text>
                    )}
                </AnimatedTouchableOpacity>
                <TouchableOpacity
                    style={[localStyles.secondaryButton, isMobile && { paddingVertical: 8 }]}
                    onPress={() => {
                        logEvent('onboarding_calendar_skipped')
                        setStep(2) // Skip Gmail, go directly to MorningReminder
                    }}
                    disabled={connectingService === 'calendar'}
                >
                    <Text style={[localStyles.secondaryButtonText, isMobile && { fontSize: 14 }]}>
                        {translate('Skip')}
                    </Text>
                </TouchableOpacity>
            </View>
        )
    }

    const renderGmailConnection = () => {
        const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity)
        return (
            <View style={localStyles.contentContainer}>
                <Icon
                    name="gmail"
                    size={isMobile ? 48 : 64}
                    color={Colors.Primary100}
                    style={{ marginBottom: isMobile ? 16 : 24 }}
                />
                <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>{translate('Connect Gmail')}</Text>
                <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                    {translate('onboarding_connect_gmail_desc')}
                </Text>
                <AnimatedTouchableOpacity
                    style={[
                        localStyles.primaryButton,
                        isMobile && { paddingVertical: 10, marginBottom: 10 },
                        connectingService === 'gmail' && { opacity: 0.7 },
                        showSuccess === 'gmail' && { backgroundColor: Colors.UtilityGreen300, opacity: blinkAnim },
                    ]}
                    onPress={() => connectService('gmail')}
                    disabled={connectingService === 'gmail' || showSuccess === 'gmail'}
                >
                    {connectingService === 'gmail' ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <ActivityIndicator color="#FFF" size="small" style={{ marginRight: 8 }} />
                            <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                                {translate('working_on_it')}
                            </Text>
                        </View>
                    ) : showSuccess === 'gmail' ? (
                        <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                            {translate('Connected!')}
                        </Text>
                    ) : (
                        <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>
                            {translate('Connect Gmail')}
                        </Text>
                    )}
                </AnimatedTouchableOpacity>
                <TouchableOpacity
                    style={[localStyles.secondaryButton, isMobile && { paddingVertical: 8 }]}
                    onPress={() => {
                        logEvent('onboarding_gmail_skipped')
                        setStep(3)
                    }}
                    disabled={connectingService === 'gmail'}
                >
                    <Text style={[localStyles.secondaryButtonText, isMobile && { fontSize: 14 }]}>
                        {translate('Skip')}
                    </Text>
                </TouchableOpacity>
            </View>
        )
    }

    const renderMorningReminderStep = () => (
        <View style={localStyles.contentContainer}>
            <Icon
                name="bell"
                size={isMobile ? 48 : 64}
                color={Colors.Primary100}
                style={{ marginBottom: isMobile ? 16 : 24 }}
            />
            <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>{translate('Morning Tasks Reminder')}</Text>
            <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                {translate('onboarding_morning_reminder_desc')}
            </Text>
            <TouchableOpacity
                style={[localStyles.primaryButton, isMobile && { paddingVertical: 10, marginBottom: 10 }]}
                onPress={() => handleMorningReminder(true)}
            >
                <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>{translate('Enable')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[localStyles.secondaryButton, isMobile && { paddingVertical: 8 }]}
                onPress={() => handleMorningReminder(false)}
            >
                <Text style={[localStyles.secondaryButtonText, isMobile && { fontSize: 14 }]}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    const renderPushNotificationStep = () => (
        <View style={localStyles.contentContainer}>
            <Icon
                name="bell"
                size={isMobile ? 48 : 64}
                color={Colors.Primary100}
                style={{ marginBottom: isMobile ? 16 : 24 }}
            />
            <Text style={[titleStyle, isMobile && { marginBottom: 8 }]}>{translate('Enable Push Notifications')}</Text>
            <Text style={[localStyles.subtitle, isMobile && { marginBottom: 24, fontSize: 14 }]}>
                {translate('onboarding_enable_push_desc')}
            </Text>
            <TouchableOpacity
                style={[localStyles.primaryButton, isMobile && { paddingVertical: 10, marginBottom: 10 }]}
                onPress={enablePushNotifications}
            >
                <Text style={[localStyles.primaryButtonText, isMobile && { fontSize: 16 }]}>{translate('Enable')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[localStyles.secondaryButton, isMobile && { paddingVertical: 8 }]}
                onPress={() => {
                    logEvent('onboarding_push_skipped')
                    proceed()
                }}
            >
                <Text style={[localStyles.secondaryButtonText, isMobile && { fontSize: 14 }]}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    return (
        <SplitLayout>
            <ProgressBar current={step} total={4} />
            {step === 0 && renderWhatsAppStep()}
            {step === 1 && renderCalendarConnection()}
            {/* Gmail step disabled: {step === 2 && renderGmailConnection()} */}
            {step === 2 && renderMorningReminderStep()}
            {step === 3 && renderPushNotificationStep()}
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
    phoneInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
    },
    countryPickerTrigger: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 48,
        backgroundColor: Colors.White,
        borderWidth: 1,
        borderColor: Colors.Grey300,
        borderRadius: 8,
        marginRight: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    dialCode: {
        ...styles.body1,
        color: Colors.Text01,
        marginHorizontal: 8,
    },
    phoneInput: {
        ...styles.body1,
        flex: 1,
        color: Colors.Text01,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderWidth: 1,
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
    modalOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    modalContent: {
        width: '90%',
        maxWidth: 400,
        maxHeight: '80%',
        backgroundColor: Colors.White,
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 5,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        ...styles.title6,
        color: Colors.Text01,
    },
    modalCloseButton: {
        padding: 4,
    },
    countryItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: Colors.Grey200,
    },
    countryItemText: {
        ...styles.body1,
        color: Colors.Text01,
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
        marginBottom: 16, // Reduced from 32
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
