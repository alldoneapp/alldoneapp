import React, { useState, useEffect } from 'react'
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native'
import { useDispatch } from 'react-redux'
import Colors from '../../Themes/Colors'
import styles from '../styles/global'
import URLSystemTrigger from '../../URLSystem/URLSystemTrigger'
import { setNavigationRoute } from '../../redux/actions'

export default function OnboardingView({ navigation }) {
    const dispatch = useDispatch()
    const [step, setStep] = useState(0)
    const [answers, setAnswers] = useState({})
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)

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

    const handleAnswer = (questionId, answer) => {
        setAnswers(prev => ({ ...prev, [questionId]: answer }))
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

    useEffect(() => {
        if (step === 3) {
            handleFinish()
        }
    }, [step])

    const renderWelcome = () => (
        <View style={localStyles.contentContainer}>
            <Text style={localStyles.title}>Welcome to Alldone!</Text>
            <Text style={localStyles.subtitle}>We're excited to have you on board.</Text>
            <TouchableOpacity style={localStyles.button} onPress={() => setStep(1)}>
                <Text style={localStyles.buttonText}>Get Started</Text>
            </TouchableOpacity>
        </View>
    )

    const renderQuestion1 = () => (
        <View style={localStyles.contentContainer}>
            <Text style={localStyles.question}>How do you plan to use Alldone?</Text>
            <View style={localStyles.optionsContainer}>
                {['Private Life', 'Work', 'Both'].map(option => (
                    <TouchableOpacity
                        key={option}
                        style={localStyles.optionButton}
                        onPress={() => handleAnswer('usage', option)}
                    >
                        <Text style={localStyles.optionText}>{option}</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    )

    const renderQuestion2 = () => (
        <View style={localStyles.contentContainer}>
            <Text style={localStyles.question}>
                Do you want to be reminded every day with your most important task of the day?
            </Text>
            <View style={localStyles.optionsContainer}>
                {['Yes', 'No'].map(option => (
                    <TouchableOpacity
                        key={option}
                        style={localStyles.optionButton}
                        onPress={() => handleAnswer('reminders', option)}
                    >
                        <Text style={localStyles.optionText}>{option}</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    )

    const renderContent = () => {
        switch (step) {
            case 0:
                return renderWelcome()
            case 1:
                return renderQuestion1()
            case 2:
                return renderQuestion2()
            case 3:
                return (
                    <View style={localStyles.contentContainer}>
                        <Text style={localStyles.title}>Setting up your trial...</Text>
                    </View>
                )
            default:
                return null
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
    },
    videoSectionDesktop: {
        width: '50%',
        height: '100%',
    },
    videoSectionMobile: {
        width: '100%',
        height: '50%',
    },
    contentSection: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    contentSectionDesktop: {
        width: '50%',
        height: '100%',
    },
    contentSectionMobile: {
        width: '100%',
        height: '50%',
    },
    contentContainer: {
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
    },
    title: {
        ...styles.title3,
        textAlign: 'center',
        marginBottom: 12,
        color: Colors.Text01,
    },
    subtitle: {
        ...styles.body1,
        textAlign: 'center',
        marginBottom: 32,
        color: Colors.Text02,
    },
    question: {
        ...styles.title4,
        textAlign: 'center',
        marginBottom: 32,
        color: Colors.Text01,
    },
    button: {
        backgroundColor: Colors.Primary100,
        paddingVertical: 16,
        paddingHorizontal: 48,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
    },
    buttonText: {
        color: Colors.White,
        fontSize: 18,
        fontWeight: '600',
    },
    optionsContainer: {
        width: '100%',
        gap: 12,
    },
    optionButton: {
        backgroundColor: Colors.White,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 12,
        width: '100%',
        borderWidth: 1,
        borderColor: Colors.Border,
        alignItems: 'center',
        marginBottom: 12,
    },
    optionText: {
        color: Colors.Text01,
        fontSize: 16,
        fontWeight: '500',
    },
})
