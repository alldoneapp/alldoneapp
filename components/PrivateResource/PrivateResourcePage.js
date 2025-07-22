import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import CustomScrollView from '../UIControls/CustomScrollView'
import Icon from '../Icon'
import LogInButton from '../UIControls/LogInButton'
import styles, { colors, em2px } from '../styles/global'
import store from '../../redux/store'
import {
    navigateToAllProjectsTasks,
    setInitialUrl,
    setLastVisitedScreen,
    setNavigationRoute,
} from '../../redux/actions'
import URLSystem, { URL_PRIVATE_RESOURCE } from '../../URLSystem/URLSystem'
import NavigationService from '../../utils/NavigationService'

export default function PrivateResourcePage({}) {
    const [width, setWidth] = useState(580)
    const [top, setTop] = useState(190)

    useEffect(() => {
        const { loggedUser } = store.getState()

        if (!loggedUser.uid || loggedUser.isAnonymous) {
            store.dispatch(setLastVisitedScreen(['/', '/login']))
            URLSystem.push(URL_PRIVATE_RESOURCE)
            store.dispatch([setNavigationRoute('PrivateResource'), setInitialUrl('/projects/tasks/open')])
        } else {
            NavigationService.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
        }
    }, [])

    const goToHome = () => {
        document.location = window.location.origin
    }

    const onLayout = e => {
        const screenWidth = e.nativeEvent.layout.width
        const screenHeight = e.nativeEvent.layout.height

        if (screenWidth < width) {
            setWidth(screenWidth)
        } else {
            setWidth(580)
        }

        if (screenHeight < 830) {
            setTop(90)
        } else {
            setTop(190)
        }
    }

    return (
        <CustomScrollView
            style={localStyles.parent}
            contentContainerStyle={localStyles.parentContent}
            scrollOnLayout={onLayout}
        >
            <View style={localStyles.container}>
                <TouchableOpacity style={localStyles.logo} onPress={goToHome}>
                    <Icon name={'logo'} size={24} color={colors.Primary100} />
                    <Text style={localStyles.alldone}>Alldone.app</Text>
                </TouchableOpacity>

                <View style={[localStyles.content, { width: width - 48 }]}>
                    <View style={{ marginTop: top }}>
                        <Image
                            source={{ uri: `${window.location.origin}/images/illustrations/Private-Resource.png` }}
                            style={{ width: width, height: (width * 826) / 1064 }}
                            resizeMode={'cover'}
                        />
                    </View>

                    <Text style={[styles.title4, localStyles.contentText]}>
                        Ups, looks like the owner of this resource set it to Private, so you can’t see it.
                    </Text>
                    <Text style={[styles.body1, localStyles.contentText]}>
                        Alldone provides awesome features to manage a wide range of projects. Create an account and try
                        them!!
                    </Text>

                    <LogInButton containerStyle={{ marginTop: 16 }} />
                </View>
            </View>
        </CustomScrollView>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        overflow: 'hidden',
        backgroundColor: '#ffffff',
    },
    parentContent: {
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        width: '100%',
        alignItems: 'center',
    },
    container: {
        width: '100%',
        // maxWidth: 944,
        alignItems: 'center',
    },
    logo: {
        position: 'absolute',
        top: 64,
        left: 64,
        flexDirection: 'row',
        width: 250,
        alignItems: 'center',
    },
    alldone: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 24,
        marginLeft: 8,
        fontWeight: 'bold',
        color: colors.Primary100,
        letterSpacing: em2px(0.02),
    },
    content: {
        maxWidth: 580,
        alignItems: 'center',
    },
    contentText: {
        color: colors.Text02,
        marginTop: 32,
        textAlign: 'center',
    },
})
