import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, Text, View, TextInput, Dimensions, TouchableOpacity, Image } from 'react-native'
import { useSelector } from 'react-redux'
import { firebase } from '@firebase/app'

import styles from '../styles/global'
import Colors from '../../Themes/Colors'
import { translate } from '../../i18n/TranslationService'
import { validatePhoneNumber } from '../../utils/phoneValidation'
import { setUserPhone } from '../../utils/backends/Users/usersFirestore'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import Icon from '../Icon'
import SplitLayout from './SplitLayout'
import { startServerSideAuth } from '../../apis/google/GoogleOAuthServerSide'

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

    const [step, setStep] = useState(0) // 0: WhatsApp, 1: Calendar, 2: Gmail

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
        setTimeout(() => phoneInputRef.current?.focus(), 100)
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
        } catch (error) {
            console.error('Error saving phone:', error)
            setValidationError('Failed to save phone number. Please try again.')
            setSaving(false)
        }
    }

    const handleSkip = () => {
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
        try {
            await startServerSideAuth(projectId, service)
            // Auto advance
            if (service === 'calendar') setStep(2)
            else proceed()
        } catch (error) {
            console.error('Connection failed', error)
        }
    }

    const renderWhatsAppStep = () => (
        <View style={localStyles.contentContainer}>
            <Image
                source={require('../../assets/whatsapp.png')}
                style={{ width: 64, height: 64, marginBottom: 24 }}
                resizeMode="contain"
            />
            <Text style={localStyles.title}>What's your WhatsApp number?</Text>
            <Text style={localStyles.subtitle}>Let's chat over there as well</Text>

            <View style={localStyles.inputContainer}>
                <Text style={localStyles.label}>WhatsApp Number</Text>
                <TextInput
                    ref={phoneInputRef}
                    style={localStyles.phoneInput}
                    value={phone}
                    placeholder="Type your phone number"
                    placeholderTextColor={Colors.Text03}
                    onChangeText={onPhoneChange}
                    keyboardType="phone-pad"
                    autoFocus={true}
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

    const renderCalendarConnection = () => (
        <View style={localStyles.contentContainer}>
            <Icon name="calendar" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
            <Text style={localStyles.title}>{translate('Connect Google Calendar')}</Text>
            <Text style={localStyles.subtitle}>{translate('onboarding_connect_calendar_desc')}</Text>
            <TouchableOpacity style={localStyles.primaryButton} onPress={() => connectService('calendar')}>
                <Text style={localStyles.primaryButtonText}>{translate('Connect Calendar')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.secondaryButton} onPress={() => setStep(2)}>
                <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    const renderGmailConnection = () => (
        <View style={localStyles.contentContainer}>
            <Icon name="gmail" size={64} color={Colors.Primary100} style={{ marginBottom: 24 }} />
            <Text style={localStyles.title}>{translate('Connect Gmail')}</Text>
            <Text style={localStyles.subtitle}>{translate('onboarding_connect_gmail_desc')}</Text>
            <TouchableOpacity style={localStyles.primaryButton} onPress={() => connectService('gmail')}>
                <Text style={localStyles.primaryButtonText}>{translate('Connect Gmail')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.secondaryButton} onPress={() => proceed()}>
                <Text style={localStyles.secondaryButtonText}>{translate('Skip')}</Text>
            </TouchableOpacity>
        </View>
    )

    return (
        <SplitLayout>
            {step === 0 && renderWhatsAppStep()}
            {step === 1 && renderCalendarConnection()}
            {step === 2 && renderGmailConnection()}
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
})
