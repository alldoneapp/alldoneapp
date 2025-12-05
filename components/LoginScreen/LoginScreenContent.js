import React, { useEffect, useState } from 'react'
import { StyleSheet, View, ImageBackground, Image, Text, ScrollView } from 'react-native'

import Icon from '../Icon'
import styles from '../styles/global'
import LogInButton from '../UIControls/LogInButton'
import URLSystem, { URL_LOGIN } from '../../URLSystem/URLSystem'
import Colors from '../../Themes/Colors'
import { getProjectData, logEvent, loginWithGoogleWebAnonymously } from '../../utils/backends/firestore'
import { useSelector, useDispatch } from 'react-redux'
import { setInitialUrl, setNavigationRoute } from '../../redux/actions'

const LOADING_LOGIN = 'LOADING_LOGIN'
const NORMAL_LOGIN = 'NORMAL_LOGIN'
const GUIDE_LOGIN = 'GUIDE_LOGIN'

export default function LoginScreenContent() {
    const dispatch = useDispatch()
    const initialUrl = useSelector(state => state.initialUrl)
    const [templateTitle, setTemplateTitle] = useState('')
    const [templateImage, setTemplateImage] = useState('')
    const [loginType, setLoginType] = useState(
        window.location.pathname.startsWith('/login') || window.location === '/' ? NORMAL_LOGIN : LOADING_LOGIN
    )

    const getProjectIdFromUrl = url => {
        return url.split('/')[2]
    }

    const selectPictureToShow = async url => {
        await loginWithGoogleWebAnonymously()

        const projectId = getProjectIdFromUrl(url)

        if (projectId) {
            const project = await getProjectData(projectId)

            const isTemplate = project && project.isTemplate
            if (isTemplate) {
                setTemplateTitle('Sign up/in with your personal email')
                setTemplateImage(require('../../web/images/illustrations/guidesLogin.png'))
            }
            setLoginType(isTemplate ? GUIDE_LOGIN : NORMAL_LOGIN)
        } else {
            setLoginType(NORMAL_LOGIN)
        }
    }

    const writeBrowserURL = () => {
        const { pathname } = window.location
        if (!pathname.startsWith('/starttrial') && !pathname.startsWith('/paymentsuccess')) {
            URLSystem.push(URL_LOGIN)
        }
    }

    useEffect(() => {
        let url = ''
        if (initialUrl === '/') {
            const { pathname, search } = window.location
            url = pathname.startsWith('/login') || pathname === '/' ? '/projects/tasks/open' : pathname + search
            dispatch(setInitialUrl(url))
        }
        url ? selectPictureToShow(url) : setLoginType(NORMAL_LOGIN)
    }, [])

    useEffect(() => {
        writeBrowserURL()
        dispatch(setNavigationRoute('LoginScreen'))
        logEvent('login_page')
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
                    {loginType === NORMAL_LOGIN && (
                        <View
                            style={{
                                width: 270,
                                height: 480,
                                borderRadius: 20,
                                overflow: 'hidden',
                                marginBottom: 20,
                                marginTop: 20,
                            }}
                        >
                            <video
                                src={require('../../assets/annasmile.mp4')}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                }}
                                autoPlay
                                loop
                                muted
                                playsInline
                            />
                        </View>
                    )}
                    {loginType === GUIDE_LOGIN && (
                        <Image
                            source={{ uri: templateImage }}
                            style={{ marginTop: 16, width: 600 * 0.51, height: 692 * 0.51 }}
                            width={600}
                            height={692}
                        />
                    )}

                    {loginType === NORMAL_LOGIN && (
                        <Text style={localStyles.title}>Sign in with your personal email</Text>
                    )}
                    {loginType === GUIDE_LOGIN && <Text style={localStyles.title}>{templateTitle}</Text>}
                    <LogInButton />
                    <Text style={localStyles.subtitle}>
                        When you sign in you accept the{' '}
                        <a
                            href="https://alldone.app/privacy"
                            target={'_blank'}
                            style={{ color: Colors.Primary100, textDecoration: 'none' }}
                        >
                            Privacy Policy
                        </a>{' '}
                        and the{' '}
                        <a
                            href="https://alldone.app/terms"
                            target={'_blank'}
                            style={{ color: Colors.Primary100, textDecoration: 'none' }}
                        >
                            Terms of Service
                        </a>{' '}
                        and want to login with your Google account
                    </Text>
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
    subtitle: {
        ...styles.body1,
        textAlign: 'center',
        color: Colors.Text01,
        paddingTop: 32,
        paddingBottom: 16,
        maxWidth: 548,
        paddingHorizontal: 16,
    },
    logoText: {
        marginLeft: 9,
    },
})
