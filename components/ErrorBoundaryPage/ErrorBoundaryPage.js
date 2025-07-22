import React, { useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import CustomScrollView from '../UIControls/CustomScrollView'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import styles, { colors, em2px } from '../styles/global'
import { deleteCacheAndRefresh } from '../../utils/Observers'

export default function ErrorBoundaryPage({}) {
    const MAX_WIDTH = 532
    const MAX_HEIGHT = 830
    const MAX_TOP = 190
    const MIN_TOP = 90
    const [width, setWidth] = useState(MAX_WIDTH)
    const [top, setTop] = useState(MAX_TOP)

    const goToHome = () => {
        window.location = '/projects/tasks/open'
    }

    const onLayout = e => {
        const screenWidth = e.nativeEvent.layout.width
        const screenHeight = e.nativeEvent.layout.height

        if (screenWidth < MAX_WIDTH) {
            setWidth(screenWidth - 48)
        } else {
            setWidth(MAX_WIDTH)
        }

        if (screenHeight < MAX_HEIGHT) {
            setTop(MIN_TOP)
        } else {
            setTop(MAX_TOP)
        }
    }

    const reload = e => {
        e?.preventDefault()
        deleteCacheAndRefresh()
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

                <View style={[localStyles.content, { width: width }]}>
                    <View style={{ marginTop: top }}>
                        <Image
                            source={{ uri: `${window.location.origin}/images/illustrations/Error.png` }}
                            style={{ width: width, height: (413 * width) / MAX_WIDTH }}
                            resizeMode={'cover'}
                        />
                    </View>

                    <Text style={[styles.title4, localStyles.contentText]}>
                        Ups, looks like there was an error - sorry!
                    </Text>
                    <Text style={[styles.body1, localStyles.contentText]}>
                        Please use the button below to reload the app and go back to normal!!
                    </Text>

                    <View style={localStyles.reload}>
                        <Button
                            type={'secondary'}
                            icon={'refresh-cw'}
                            title={'Reload app'}
                            onPress={reload}
                            buttonStyle={{ marginRight: 8 }}
                        />
                        <Button type={'primary'} icon={'logo'} title={'Go to home'} onPress={goToHome} />
                    </View>
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
        maxWidth: 532,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contentText: {
        color: colors.Text02,
        marginTop: 32,
        textAlign: 'center',
    },
    reload: {
        flexDirection: 'row',
        alignSelf: 'center',
        marginTop: 16,
    },
})
