import React, { useEffect, useState } from 'react'
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native'

import Backend from '../../utils/BackendBridge'
import Colors from '../../Themes/Colors'
import { isCapacitorIosShell, isCapacitorShell } from '../../utils/CapacitorShell'

export default function LogInButton({ btnId = 'google-sign-in-btn', containerStyle }) {
    // Google Identity Services renders its desktop button into a cross-origin iframe. Mobile and
    // local development use our button so Firebase can choose the same-origin redirect flow.
    const [useCustomButton, setUseCustomButton] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')

    useEffect(() => {
        const custom = Backend.isMobileDevice() || Backend.isLocalDevHost()
        setUseCustomButton(custom)

        if (!custom) {
            // Desktop: use GSI popup flow
            const scriptGoogleGSI = document.createElement('script')
            scriptGoogleGSI.src = 'https://accounts.google.com/gsi/client'
            scriptGoogleGSI.async = true
            scriptGoogleGSI.defer = true
            scriptGoogleGSI.onload = renderLoginButton

            document.body.appendChild(scriptGoogleGSI)
        }
    }, [])

    const renderLoginButton = () => {
        Backend.loginWithGoogle()
        window.google.accounts.id.renderButton(document.getElementById(btnId), {
            theme: 'outline',
            size: 'large',
        })
        document.cookie = 'g_state=; Max-Age=-99999999;'
    }

    const handleCustomButtonLogin = async () => {
        setErrorMessage('')
        setIsLoading(true)
        try {
            const user = await Backend.signInWithGoogleRedirect()
            // Redirect navigation does not resolve on the outgoing page. If a popup fallback was
            // used, onAuthStateChanged handles the returned user.
            if (user) {
                if (__DEV__) console.log('User signed in via popup:', user.email)
            } else if (isCapacitorShell()) {
                // In the shell a null result means the native sheet was cancelled.
                // On the web it means a redirect is in flight — keep the spinner.
                setIsLoading(false)
            }
        } catch (error) {
            console.error('Error during Google sign-in:', error)
            setErrorMessage('Google sign-in could not be started. Please try again.')
            setIsLoading(false)
        }
    }

    const handleAppleLogin = async () => {
        setErrorMessage('')
        setIsLoading(true)
        try {
            const user = await Backend.signInWithApple()
            if (!user) setIsLoading(false) // sheet cancelled
        } catch (error) {
            console.error('Error during Apple sign-in:', error)
            // TODO(temporary): surface the underlying error detail while Apple
            // sign-in is being verified on real devices — remove before release.
            const detail = [error?.code, error?.message].filter(Boolean).join(' — ')
            setErrorMessage(`Apple sign-in could not be started. Please try again.${detail ? `\n(${detail})` : ''}`)
            setIsLoading(false)
        }
    }

    if (useCustomButton) {
        // Mobile and dev server: use the redirect flow with our own button
        return (
            <View style={containerStyle}>
                <TouchableOpacity
                    style={localStyles.googleButton}
                    onPress={handleCustomButtonLogin}
                    disabled={isLoading}
                    accessibilityLabel="Sign in with Google"
                >
                    {isLoading ? (
                        <ActivityIndicator color={Colors.Text01} size="small" />
                    ) : (
                        <>
                            <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 12 }}>
                                <path
                                    fill="#4285F4"
                                    d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M9.003 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.26c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9.003 18z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.33z"
                                />
                                <path
                                    fill="#EA4335"
                                    d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.002 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z"
                                />
                            </svg>
                            <Text style={localStyles.buttonText}>Sign in with Google</Text>
                        </>
                    )}
                </TouchableOpacity>
                {isCapacitorIosShell() && (
                    <TouchableOpacity
                        style={[localStyles.googleButton, localStyles.appleButton]}
                        onPress={handleAppleLogin}
                        disabled={isLoading}
                        accessibilityLabel="Sign in with Apple"
                    >
                        <svg width="16" height="18" viewBox="0 0 814 1000" style={{ marginRight: 12 }}>
                            <path
                                fill="#ffffff"
                                d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
                            />
                        </svg>
                        <Text style={[localStyles.buttonText, localStyles.appleButtonText]}>Sign in with Apple</Text>
                    </TouchableOpacity>
                )}
                {!!errorMessage && (
                    <Text style={localStyles.errorText} accessibilityLiveRegion="polite" accessibilityRole="alert">
                        {errorMessage}
                    </Text>
                )}
            </View>
        )
    }

    // Desktop: use GSI button
    return (
        <View style={containerStyle}>
            <div id={btnId} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#dadce0',
        borderRadius: 4,
        paddingVertical: 10,
        paddingHorizontal: 24,
        minWidth: 200,
        boxShadow: '0px 1px 1px rgba(0,0,0,0.10)',
        elevation: 1,
    },
    buttonText: {
        color: '#3c4043',
        fontSize: 14,
        fontWeight: '500',
        fontFamily: 'Roboto, sans-serif',
    },
    appleButton: {
        backgroundColor: '#000',
        borderColor: '#000',
        marginTop: 12,
    },
    appleButtonText: {
        color: '#fff',
    },
    errorText: {
        color: Colors.UtilityRed300,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
        maxWidth: 260,
        textAlign: 'center',
    },
})
