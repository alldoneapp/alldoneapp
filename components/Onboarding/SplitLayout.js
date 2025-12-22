import React, { useState, useEffect } from 'react'
import { StyleSheet, View, Dimensions, ScrollView } from 'react-native'
import Colors from '../../Themes/Colors'

export default function SplitLayout({
    children,
    videoSrc = require('../../assets/annasmile.mp4'),
    hideVideoOnMobile = false,
}) {
    const [windowWidth, setWindowWidth] = useState(Dimensions.get('window').width)

    useEffect(() => {
        const updateDimensions = () => {
            setWindowWidth(Dimensions.get('window').width)
        }
        Dimensions.addEventListener('change', updateDimensions)
        return () => {
            Dimensions.removeEventListener('change', updateDimensions)
        }
    }, [])

    const isDesktop = windowWidth > 768

    const showVideo = isDesktop || !hideVideoOnMobile

    return (
        <View style={[styles.container, isDesktop ? styles.containerDesktop : styles.containerMobile]}>
            {showVideo && (
                <View style={[styles.videoSection, isDesktop ? styles.videoSectionDesktop : styles.videoSectionMobile]}>
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            position: 'relative',
                        }}
                        dangerouslySetInnerHTML={{
                            __html: `<video 
                                style="width: 100%; height: 100%; object-fit: cover; object-position: ${
                                    isDesktop ? 'center center' : 'center 20%'
                                }; display: block;"
                                autoplay
                                loop
                                muted
                                playsinline
                                webkit-playsinline
                            >
                                <source src="${videoSrc}" type="video/mp4">
                            </video>`,
                        }}
                    />
                </View>
            )}

            {showVideo && <View style={isDesktop ? styles.separatorDesktop : styles.separatorMobile} />}

            <ScrollView
                style={{ flex: 1, width: '100%' }}
                contentContainerStyle={[
                    styles.contentSection,
                    isDesktop ? styles.contentSectionDesktop : styles.contentSectionMobile,
                ]}
                showsVerticalScrollIndicator={false}
            >
                {children}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
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
        maxWidth: 500,
        height: '100%',
    },
    videoSectionMobile: {
        width: '100%',
        height: '20%',
    },
    contentSection: {
        backgroundColor: Colors.White,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contentSectionDesktop: {
        flex: 1,
        height: '100%',
        padding: 40,
    },
    contentSectionMobile: {
        width: '100%',
        flex: 1,
        justifyContent: 'flex-start', // Use flex-start with padding for better control
        padding: 16, // Add proper padding
    },
    separatorDesktop: {
        width: 2,
        height: '100%',
        backgroundColor: Colors.Grey300,
    },
    separatorMobile: {
        width: '100%',
        height: 2,
        backgroundColor: Colors.Grey300,
        alignSelf: 'stretch',
    },
})
