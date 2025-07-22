import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import Button from '../UIControls/Button'
import SVGCookie from '../../assets/SVGCookie'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'

export default function CookieClickerPopup({}) {
    const [showPopup, setShowPopup] = useState(showPopup)

    useEffect(() => {
        // ask for cookie in localStorage
        const cookie = JSON.parse(localStorage.getItem('alldone_cookie'))
        if (!cookie || !cookie.cookiesEnabled) {
            setShowPopup(true)
        }
    }, [])

    const goToImprint = () => {
        window.open(`https://alldone.app/impressum`, '_blank')
        acceptCookies()
    }

    const goToPrivacy = () => {
        window.open(`https://alldone.app/privacy`, '_blank')
        acceptCookies()
    }

    const goToTerms = () => {
        window.open(`https://alldone.app/terms`, '_blank')
        acceptCookies()
    }

    const acceptCookies = () => {
        setShowPopup(false)
        const cookie = JSON.parse(localStorage.getItem('alldone_cookie')) || {}
        cookie.cookiesEnabled = true
        // set cookie in localStorage
        localStorage.setItem('alldone_cookie', JSON.stringify(cookie))
    }

    return showPopup ? (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.backdrop} onPress={acceptCookies} />
            <View style={localStyles.popup}>
                <View style={{ flexDirection: 'row', marginBottom: 16, alignSelf: 'flex-start' }}>
                    <SVGCookie />
                    <Text style={[styles.title4, { color: colors.Text01, marginLeft: 8 }]}>Cookies & Privacy</Text>
                </View>
                <View style={{ marginBottom: 16 }}>
                    <Text style={[styles.body1, { color: colors.Text02 }]}>
                        We use cookies to ensure you have the best user experience. If you continue, we'll assume that
                        you are happy to receive all cookies on Alldone.app. However, if you would like to know more
                        about it visit out{' '}
                        <Text onPress={goToImprint} style={[styles.body1, { color: colors.Primary100 }]}>
                            Impressum
                        </Text>
                        {', '}
                        <Text onPress={goToPrivacy} style={[styles.body1, { color: colors.Primary100 }]}>
                            Privacy Policy
                        </Text>
                        {' and '}
                        <Text onPress={goToTerms} style={[styles.body1, { color: colors.Primary100 }]}>
                            Terms of Service
                        </Text>{' '}
                        pages.
                    </Text>
                </View>
                <View style={{ flexDirection: 'row', flex: 0 }}>
                    <Button title={'I am happy with this'} onPress={acceptCookies} />
                </View>
            </View>
        </View>
    ) : (
        <View style={{ display: 'none' }} />
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10100,
    },
    popup: {
        marginHorizontal: 32,
        marginBottom: 64,
        backgroundColor: '#ffffff',
        padding: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 8,
        alignItems: 'center',
        maxWidth: 944,
        minWidth: 280,
        zIndex: 11000,
    },
})
