import React, { useEffect, useState, useRef } from 'react'
import { View, Image, StyleSheet, Animated, Text } from 'react-native'
import { createPortal } from 'react-dom'
import { runHttpsCallableFunction } from '../../../utils/backends/firestore'
import { colors } from '../../styles/global'
import Icon from '../../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'

export const ANIMATION_DURATION = 2000 // 2 seconds

// Search terms for celebration GIFs
const CELEBRATION_SEARCH_TERMS = [
    'celebration confetti',
    'success party',
    'victory dance',
    'all done',
    'well done',
    'amazing',
    'mission accomplished',
]

export default function TaskCompletionAnimation({ visible, onAnimationComplete }) {
    const opacity = useRef(new Animated.Value(0)).current
    const [gifUrl, setGifUrl] = useState(null)
    const isMounted = useRef(true)

    useEffect(() => {
        return () => {
            isMounted.current = false
        }
    }, [])

    useEffect(() => {
        if (visible) {
            // Get a random search term
            const searchTerm = CELEBRATION_SEARCH_TERMS[Math.floor(Math.random() * CELEBRATION_SEARCH_TERMS.length)]

            // Fetch a random celebration GIF from Giphy via cloud function
            runHttpsCallableFunction('giphyRandomGif', { tag: searchTerm, rating: 'g' })
                .then(result => {
                    if (result.success && result.gif && result.gif.images && isMounted.current) {
                        // Use the downsized version for better performance
                        const url = result.gif.images.downsized.url

                        // Start animation sequence only after GIF is loaded
                        Image.prefetch(url)
                            .then(() => {
                                if (isMounted.current) {
                                    // Set the URL only after successful prefetch - this will trigger render
                                    setGifUrl(url)
                                    Animated.sequence([
                                        Animated.timing(opacity, {
                                            toValue: 1,
                                            duration: 300,
                                            useNativeDriver: true,
                                        }),
                                        Animated.delay(ANIMATION_DURATION - 600),
                                        Animated.timing(opacity, {
                                            toValue: 0,
                                            duration: 300,
                                            useNativeDriver: true,
                                        }),
                                    ]).start(() => {
                                        if (isMounted.current) {
                                            setGifUrl(null)
                                            onAnimationComplete()
                                        }
                                    })
                                }
                            })
                            .catch(err => {
                                console.error('TaskCompletionAnimation: Image prefetch failed:', err)
                                if (isMounted.current) {
                                    onAnimationComplete()
                                }
                            })
                    } else {
                        if (isMounted.current) {
                            onAnimationComplete()
                        }
                    }
                })
                .catch(error => {
                    console.error('TaskCompletionAnimation: Error fetching GIF:', error)
                    if (isMounted.current) {
                        onAnimationComplete()
                    }
                })
        }
    }, [visible])

    if (!visible || !gifUrl) {
        return null
    }

    const modal = (
        <View style={styles.modalContainer}>
            <Animated.View style={[styles.content, { opacity }]}>
                <Image source={{ uri: gifUrl }} style={styles.gif} resizeMode="contain" />
                <Image
                    source={require('../../../assets/gifs/Poweredby_100px-White_VertLogo.png')}
                    style={styles.giphyLogo}
                    resizeMode="contain"
                />
            </Animated.View>
            <TouchableOpacity style={styles.closeButton} onPress={onAnimationComplete}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )

    return createPortal(modal, document.body)
}

const styles = StyleSheet.create({
    modalContainer: {
        position: 'fixed',
        top: '150px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '300px',
        borderRadius: '8px',
        overflow: 'hidden',
        zIndex: 1000000,
    },
    content: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '300px',
        height: '100%',
        // backgroundColor: 'rgba(0, 0, 0, 0.1)',
        paddingBottom: '0px',
    },
    gif: {
        width: '100%',
        height: '300px',
    },
    giphyLogo: {
        width: '50px',
        height: '15px',
        marginTop: '5px',
    },
    closeButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        borderRadius: '50%',
    },
})
