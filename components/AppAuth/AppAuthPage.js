import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, ImageBackground, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'

import Icon from '../Icon'
import styles from '../styles/global'
import URLSystem, { URL_APP_AUTH } from '../../URLSystem/URLSystem'
import Colors from '../../Themes/Colors'
import { useDispatch, useSelector } from 'react-redux'
import { setNavigationRoute } from '../../redux/actions'
import { logEvent, mintMenubarAppToken } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'

const APP_SCHEME = 'hybridmeetingguard'

const buildAppAuthUrl = ({ token, email, name, gold }) => {
    const params = [
        `provider=${encodeURIComponent('alldone-app')}`,
        `token=${encodeURIComponent(token || '')}`,
        `email=${encodeURIComponent(email || '')}`,
        `name=${encodeURIComponent(name || '')}`,
        `gold=${encodeURIComponent(gold != null ? gold : 0)}`,
    ]
    return `${APP_SCHEME}://auth?${params.join('&')}`
}

export default function AppAuthPage() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const [appUrl, setAppUrl] = useState('')
    const [error, setError] = useState(false)
    const mintingRef = useRef(false)

    const mintTokenAndOpenApp = async () => {
        if (mintingRef.current) return
        mintingRef.current = true
        setError(false)

        try {
            const result = await mintMenubarAppToken()
            const { token, email, name, gold } = result.data || {}
            if (!token) throw new Error('No token returned')

            const url = buildAppAuthUrl({
                token,
                email: email || loggedUser.email,
                name: name || loggedUser.displayName,
                gold: gold != null ? gold : loggedUser.gold,
            })
            setAppUrl(url)
            logEvent('menubar_app_token_minted')

            // Browsers often block automatic custom-scheme navigation,
            // so the visible button below stays as the fallback
            window.location.href = url
        } catch (e) {
            console.error('AppAuthPage: failed to mint menubar app token', e)
            setError(true)
        } finally {
            mintingRef.current = false
        }
    }

    useEffect(() => {
        URLSystem.push(URL_APP_AUTH)
        dispatch(setNavigationRoute('AppAuth'))
        mintTokenAndOpenApp()
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

                    {error ? (
                        <>
                            <Text style={localStyles.title}>{translate('App sign-in failed')}</Text>
                            <Text style={localStyles.subtitle}>
                                {translate('Something went wrong while connecting the app to your account')}
                            </Text>
                            <TouchableOpacity style={localStyles.openButton} onPress={mintTokenAndOpenApp}>
                                <Text style={localStyles.openButtonText}>{translate('Try again')}</Text>
                            </TouchableOpacity>
                        </>
                    ) : !appUrl ? (
                        <>
                            <ActivityIndicator size="large" color={Colors.Primary100} style={localStyles.spinner} />
                            <Text style={localStyles.title}>{translate('Connecting Anna Alldone')}</Text>
                        </>
                    ) : (
                        <>
                            <Text style={localStyles.title}>{translate('Connecting Anna Alldone')}</Text>
                            <a href={appUrl} style={{ textDecoration: 'none' }}>
                                <View style={localStyles.openButton}>
                                    <Text style={localStyles.openButtonText}>{translate('Open Anna Alldone')}</Text>
                                </View>
                            </a>
                            <Text style={localStyles.subtitle}>
                                {translate('If the app did not open automatically, click the button above')}
                            </Text>
                            <Text style={localStyles.subtitle}>
                                {translate('You can close this tab once the app has opened')}
                            </Text>
                        </>
                    )}
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
    spinner: {
        marginTop: 48,
    },
    title: {
        ...styles.title4,
        textAlign: 'center',
        color: Colors.Text02,
        padding: 16,
        maxWidth: 572,
    },
    openButton: {
        backgroundColor: Colors.Primary100,
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 8,
        marginTop: 8,
        marginBottom: 16,
    },
    openButtonText: {
        color: Colors.White,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    subtitle: {
        ...styles.body1,
        textAlign: 'center',
        color: Colors.Text01,
        paddingTop: 8,
        maxWidth: 548,
        paddingHorizontal: 16,
    },
    logoText: {
        marginLeft: 9,
    },
})
