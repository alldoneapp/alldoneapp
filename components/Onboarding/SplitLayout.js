import React, { useState, useEffect } from 'react'
import { StyleSheet, View, Dimensions } from 'react-native'
import Colors from '../../Themes/Colors'

export default function SplitLayout({ children, videoSrc = require('../../assets/annasmile.mp4') }) {
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

    return (
        <View style={[styles.container, isDesktop ? styles.containerDesktop : styles.containerMobile]}>
            <View style={[styles.videoSection, isDesktop ? styles.videoSectionDesktop : styles.videoSectionMobile]}>
                <video
                    src={videoSrc}
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

            <View style={isDesktop ? styles.separatorDesktop : styles.separatorMobile} />

            <View
                style={[styles.contentSection, isDesktop ? styles.contentSectionDesktop : styles.contentSectionMobile]}
            >
                {children}
            </View>
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
        height: '35%',
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
        justifyContent: 'center', // Changed from flex-start to center to avoid top gap
        paddingTop: 0,
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
