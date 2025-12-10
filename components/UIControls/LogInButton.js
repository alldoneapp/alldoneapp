import React, { useEffect } from 'react'
import { View } from 'react-native'

import Backend from '../../utils/BackendBridge'

export default function LogInButton({ btnId = 'google-sign-in-btn', containerStyle }) {
    useEffect(() => {
        const scriptGoogleGSI = document.createElement('script')
        scriptGoogleGSI.src = 'https://accounts.google.com/gsi/client'
        scriptGoogleGSI.async = true
        scriptGoogleGSI.defer = true
        scriptGoogleGSI.onload = renderLoginButton

        document.body.appendChild(scriptGoogleGSI)
    }, [])

    const renderLoginButton = () => {
        Backend.loginWithGoogle()
        window.google.accounts.id.renderButton(
            document.getElementById(btnId),
            { theme: 'outline', size: 'large' } // customization attributes
        )
        document.cookie = 'g_state=; Max-Age=-99999999;'
        // !loggedIn && window.google.accounts.id.prompt()      // Uncomment this if want auto prompt the Login Popup

        if (typeof gtag === 'function') {
            gtag('event', 'login_button_rendered', {
                event_category: 'login',
                event_label: 'google_signin_rendered',
            })
        }
    }

    return (
        <View style={containerStyle}>
            <div id={btnId} />
        </View>
    )
}
