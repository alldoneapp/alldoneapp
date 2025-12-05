import React, { useState, useEffect } from 'react'
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native'
import { useDispatch } from 'react-redux'
import Colors from '../../Themes/Colors'
import styles from '../styles/global'
import URLSystemTrigger from '../../URLSystem/URLSystemTrigger'
import { setNavigationRoute } from '../../redux/actions'
import Icon from '../Icon'
import WhatsAppMockup from './WhatsAppMockup'

export default function OnboardingView({ navigation }) {
    const dispatch = useDispatch()
    const [step, setStep] = useState(0)
    const [answers, setAnswers] = useState({})
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)
    const [chatMessages, setChatMessages] = useState([])
    const [chatOptions, setChatOptions] = useState([])

    useEffect(() => {
        dispatch(setNavigationRoute('Onboarding'))

        const updateDimensions = () => {
            setWindowWidth(Dimensions.get('window').width)
        }

        Dimensions.addEventListener('change', updateDimensions)
        return () => {
            Dimensions.removeEventListener('change', updateDimensions)
        }
    }, [])

    const isDesktop = windowWidth > 768

    const [isTyping, setIsTyping] = useState(false)

    // Helper to simulate typing and sending messages
    const sendAnnaMessages = async (messages, options = [], delay = 3000) => {
        setIsTyping(true)
        await new Promise(resolve => setTimeout(resolve, delay))
        setIsTyping(false)
        setChatMessages(prev => [...prev, ...messages])
        if (options.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            setChatOptions(options)
        }
    }

    // Initialize chat for step 1
    useEffect(() => {
        const runStep = async () => {
            if (step === 1) {
                // Initial greeting - no typing delay needed or short one
                setChatMessages([
                    { sender: 'anna', text: "Hi I am Anna. Your AI 'Chief of Staff' to get it all done." },
                    {
                        sender: 'anna',
                        text:
                            'You can chat naturally with me on Whatsapp or on our web app just like you would with a human assistant.',
                    },
                ])
                setTimeout(() => {
                    setChatOptions(['Sounds good ... so what can you do for me?'])
                }, 1000)
            } else if (step === 2) {
                await sendAnnaMessages(
                    [
                        { sender: 'anna', text: 'I can handle your tasks, notes, calendar & more on your behalf.' },
                        { sender: 'anna', text: "Why don't you try it out right now to add a new task?" },
                    ],
                    ['Prepare meeting with Claudia']
                )
            } else if (step === 3) {
                await sendAnnaMessages(
                    [
                        {
                            sender: 'anna',
                            text:
                                'I just added "Prepare meeting with Claudia" to your tasks in the project "Work". Here is a link to it.',
                        },
                        {
                            sender: 'anna',
                            text: 'Btw: You can also let me search your notes for you. Pelase give it a try.',
                        },
                    ],
                    ['Thanks. What did I last discuss with Frank?']
                )
            } else if (step === 4) {
                await sendAnnaMessages(
                    [
                        {
                            sender: 'anna',
                            text:
                                'In your meeting notes from the 10th of March with Frank you discussed how to write a good screenplay. Here are the full notes (link).',
                        },
                        {
                            sender: 'anna',
                            text: 'Btw: you can also add to your notes by just telling me for example via a voice note',
                        },
                    ],
                    ['This is great. What else?']
                )
            } else if (step === 5) {
                await sendAnnaMessages(
                    [
                        {
                            sender: 'anna',
                            text:
                                'Since I am a Chief of Staff I can also manage your "Staff" for you. Both AI and humans.',
                        },
                        {
                            sender: 'anna',
                            text:
                                'For example I can ask "Rudy Research" to see what\'s going on in your area every week so you can plan your weekend properly.',
                        },
                        {
                            sender: 'anna',
                            text: 'Or I can ask an AI to join your meetings and take automatic meeting notes.',
                        },
                    ],
                    ['Can you also remind me of my tasks so I dont forget?']
                )
            } else if (step === 6) {
                await sendAnnaMessages(
                    [
                        {
                            sender: 'anna',
                            text:
                                'Yes sure. Do you want me to remind you every morning with the most important task of the day?',
                        },
                    ],
                    ['Yes, please', 'No thank you']
                )
            } else if (step === 7) {
                await sendAnnaMessages(
                    [
                        { sender: 'anna', text: 'Ok thanks will do!' },
                        {
                            sender: 'anna',
                            text:
                                'Remember that you can always also just use our web app to use the same tool i am using internally to help you organize your life so you keep full control.',
                        },
                        {
                            sender: 'anna',
                            text:
                                "Now let's start the trial to test me for free. Looking foward to working with you and to get it all done!",
                        },
                    ],
                    ["Ok let's go!"]
                )
            } else if (step === 8) {
                handleFinish()
            }
        }
        runStep()
    }, [step])

    const handleAnswer = (questionId, answer) => {
        setChatOptions([]) // Clear options while processing

        // Add user message
        setChatMessages(prev => [...prev, { sender: 'user', text: answer }])

        if (questionId) {
            setAnswers(prev => ({ ...prev, [questionId]: answer }))
        }
        setStep(prev => prev + 1)
    }

    const handleFinish = () => {
        // Here we could save the answers to the backend if needed
        console.log('Onboarding answers:', answers)

        // Proceed to the original starttrial logic
        const params = navigation.state.params || {}
        let planType = 'monthly'
        if (params.plan) {
            planType = params.plan
        } else if (params.type) {
            planType = params.type
        } else {
            // Fallback to window location if available, or default
            const urlParams = new URLSearchParams(window.location.search)
            planType = urlParams.get('plan') || urlParams.get('type') || 'monthly'
        }

        URLSystemTrigger.redirectToStripe(planType)
    }

    const renderLogo = () => (
        <View style={localStyles.logoContainer}>
            <Icon size={32} name={'logo'} color={Colors.Primary100} />
            <Icon style={{ marginLeft: 12 }} size={32} name={'logo-name'} color={Colors.Primary100} />
        </View>
    )

    const renderWelcome = () => (
        <View style={localStyles.contentContainer}>
            {renderLogo()}
            <Text style={localStyles.title}>Welcome to Alldone!</Text>
            <Text style={localStyles.subtitle}>Let me show you how I can help you</Text>
            <TouchableOpacity style={localStyles.primaryButton} onPress={() => setStep(1)}>
                <Text style={localStyles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>
        </View>
    )

    const renderInteractiveChat = () => (
        <View style={localStyles.contentContainer}>
            {isDesktop && renderLogo()}
            <View
                style={{
                    height: isDesktop ? 600 : 450,
                    width: '100%',
                    alignItems: 'center',
                    marginTop: isDesktop ? 0 : -80, // Move up on mobile
                }}
            >
                <WhatsAppMockup
                    isTyping={isTyping}
                    messages={chatMessages}
                    options={chatOptions}
                    onOptionSelect={option => {
                        // Just advance step for most interactions, capture specific answers if needed
                        if (step === 6) {
                            handleAnswer('reminders', option)
                        } else {
                            handleAnswer(null, option)
                        }
                    }}
                    style={{ transform: [{ scale: 1 }], height: '100%', width: 300 }}
                />
            </View>
        </View>
    )

    const renderContent = () => {
        if (step === 0) {
            return renderWelcome()
        } else {
            return renderInteractiveChat()
        }
    }

    return (
        <View style={[localStyles.container, isDesktop ? localStyles.containerDesktop : localStyles.containerMobile]}>
            <View
                style={[
                    localStyles.videoSection,
                    isDesktop ? localStyles.videoSectionDesktop : localStyles.videoSectionMobile,
                ]}
            >
                <video
                    src={require('../../assets/annasmile.mp4')}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: isDesktop ? 'center center' : 'center 20%',
                        display: 'block',
                    }}
                    autoPlay
                    loop
                    muted
                    playsInline
                />
            </View>
            <View
                style={[
                    localStyles.contentSection,
                    isDesktop ? localStyles.contentSectionDesktop : localStyles.contentSectionMobile,
                ]}
            >
                {renderContent()}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.White,
    },
    containerDesktop: {
        flexDirection: 'row',
    },
    containerMobile: {
        flexDirection: 'column',
    },
    videoSection: {
        backgroundColor: '#000',
        overflow: 'hidden',
        position: 'relative',
    },
    videoSectionDesktop: {
        width: '50%',
        height: '100%',
    },
    videoSectionMobile: {
        width: '100%',
        height: '45%', // Slightly reduced to give more space to content
    },
    phoneOverlay: {
        position: 'absolute',
        zIndex: 10,
    },
    phoneOverlayDesktop: {
        bottom: -120,
        right: 40,
        transform: [{ scale: 0.85 }, { rotate: '6deg' }],
    },
    phoneOverlayMobile: {
        bottom: -230,
        right: -20,
        transform: [{ scale: 0.6 }, { rotate: '6deg' }],
    },
    contentSection: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        zIndex: 20, // Ensure it overlaps video section if needed
    },
    contentSectionDesktop: {
        width: '50%',
        height: '100%',
    },
    contentSectionMobile: {
        width: '100%',
        height: '55%',
    },
    contentContainer: {
        width: '100%',
        maxWidth: 480,
        alignItems: 'center',
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 48,
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
    question: {
        ...styles.title3,
        textAlign: 'center',
        marginBottom: 40,
        color: Colors.Text01,
    },
    primaryButton: {
        backgroundColor: Colors.Primary100,
        paddingVertical: 20,
        paddingHorizontal: 48,
        borderRadius: 16,
        width: '100%',
        alignItems: 'center',
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
    optionsContainer: {
        width: '100%',
        // gap: 16, // not supported in RN
    },
    optionButton: {
        backgroundColor: Colors.White,
        paddingVertical: 20,
        paddingHorizontal: 32,
        borderRadius: 16,
        width: '100%',
        borderWidth: 1,
        borderColor: Colors.Grey300,
        alignItems: 'center',
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    optionText: {
        color: Colors.Text01,
        fontSize: 18,
        fontWeight: '500',
    },
})
