import React, { useRef, useEffect } from 'react'
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity, Animated, Easing } from 'react-native'
import Colors from '../../Themes/Colors'
import Icon from '../Icon'

const TypingIndicator = () => {
    const dot1Opacity = useRef(new Animated.Value(0)).current
    const dot2Opacity = useRef(new Animated.Value(0)).current
    const dot3Opacity = useRef(new Animated.Value(0)).current

    useEffect(() => {
        const animate = () => {
            const duration = 300
            const sequence = [
                Animated.sequence([
                    Animated.timing(dot1Opacity, { toValue: 1, duration, useNativeDriver: true }),
                    Animated.timing(dot1Opacity, { toValue: 0.3, duration, useNativeDriver: true }),
                ]),
                Animated.sequence([
                    Animated.timing(dot2Opacity, { toValue: 1, duration, useNativeDriver: true }),
                    Animated.timing(dot2Opacity, { toValue: 0.3, duration, useNativeDriver: true }),
                ]),
                Animated.sequence([
                    Animated.timing(dot3Opacity, { toValue: 1, duration, useNativeDriver: true }),
                    Animated.timing(dot3Opacity, { toValue: 0.3, duration, useNativeDriver: true }),
                ]),
            ]

            Animated.loop(Animated.stagger(150, sequence)).start()
        }

        animate()
    }, [])

    const dotStyle = {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#8E8E93',
        marginHorizontal: 2,
    }

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 20, width: 40 }}>
            <Animated.View style={[dotStyle, { opacity: dot1Opacity }]} />
            <Animated.View style={[dotStyle, { opacity: dot2Opacity }]} />
            <Animated.View style={[dotStyle, { opacity: dot3Opacity }]} />
        </View>
    )
}

export default function WhatsAppMockup({ messages = [], options = [], onOptionSelect, style, isTyping }) {
    const scrollViewRef = useRef()

    return (
        <View style={[styles.phoneFrame, style]}>
            {/* Status Bar Mockup */}
            <View style={styles.statusBar}>
                <Text style={styles.timeText}>9:41</Text>
                <View style={styles.statusIcons}>
                    <View style={styles.signalIcon} />
                    <View style={styles.wifiIcon} />
                    <View style={styles.batteryIcon} />
                </View>
            </View>

            {/* WhatsApp Header */}
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Icon name="chevron-left" size={24} color={Colors.Primary100} />
                    <Image source={require('../../web/images/illustrations/AnnaAlldone.png')} style={styles.avatar} />
                    <View style={styles.headerInfo}>
                        <Text style={styles.headerName}>Anna Alldone</Text>
                        <Text style={styles.headerStatus}>{isTyping ? 'typing...' : 'Online'}</Text>
                    </View>
                </View>
                <View style={styles.headerRight}>
                    <Icon name="video" size={20} color={Colors.Primary100} style={{ marginRight: 16 }} />
                    <Icon name="phone" size={20} color={Colors.Primary100} />
                </View>
            </View>

            {/* Chat Area */}
            <ScrollView
                ref={scrollViewRef}
                style={styles.chatArea}
                contentContainerStyle={{ padding: 12 }}
                onContentSizeChange={() => scrollViewRef.current.scrollToEnd({ animated: true })}
            >
                <View style={styles.dateBubble}>
                    <Text style={styles.dateText}>Today</Text>
                </View>

                {messages.map((msg, index) => (
                    <View
                        key={index}
                        style={msg.sender === 'user' ? styles.messageBubbleSent : styles.messageBubbleReceived}
                    >
                        <Text style={msg.sender === 'user' ? styles.messageTextSent : styles.messageText}>
                            {msg.text.split(/(\(link\)|link)/gi).map((part, i) => {
                                if (part.toLowerCase() === 'link' || part.toLowerCase() === '(link)') {
                                    return (
                                        <Text key={i} style={{ color: '#007AFF', textDecorationLine: 'underline' }}>
                                            {part}
                                        </Text>
                                    )
                                }
                                return part
                            })}
                        </Text>
                        <Text style={msg.sender === 'user' ? styles.timeSent : styles.timeReceived}>
                            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {msg.sender === 'user' && (
                            <View style={styles.ticks}>
                                <Icon name="check-double" size={12} color={Colors.Primary100} />
                            </View>
                        )}
                    </View>
                ))}

                {isTyping && (
                    <View style={[styles.messageBubbleReceived, { paddingVertical: 12, paddingHorizontal: 16 }]}>
                        <TypingIndicator />
                    </View>
                )}

                {/* Options / Quick Replies */}
                {options.length > 0 && (
                    <View style={styles.optionsContainer}>
                        {options.map((option, index) => (
                            <TouchableOpacity
                                key={index}
                                style={styles.optionBubble}
                                onPress={() => onOptionSelect && onOptionSelect(option)}
                            >
                                <Text style={styles.optionText}>{option}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Home Indicator */}
            <View style={styles.homeIndicatorContainer}>
                <View style={styles.homeIndicator} />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    phoneFrame: {
        width: 280,
        height: 500,
        backgroundColor: '#fff',
        borderRadius: 40,
        borderWidth: 8,
        borderColor: '#1c1c1e',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.3,
        shadowRadius: 40,
        elevation: 20,
    },
    statusBar: {
        height: 44,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        backgroundColor: '#F6F6F6',
    },
    timeText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#000',
    },
    statusIcons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    signalIcon: { width: 16, height: 10, backgroundColor: '#000', borderRadius: 2 },
    wifiIcon: { width: 16, height: 10, backgroundColor: '#000', borderRadius: 4 },
    batteryIcon: { width: 20, height: 10, borderWidth: 1, borderColor: '#000', borderRadius: 2 },

    header: {
        height: 60,
        backgroundColor: '#F6F6F6',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E5EA',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        marginLeft: 4,
        marginRight: 8,
    },
    headerInfo: {
        justifyContent: 'center',
    },
    headerName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000',
    },
    headerStatus: {
        fontSize: 12,
        color: '#8E8E93',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    chatArea: {
        flex: 1,
        backgroundColor: '#EFEFF4', // WhatsApp default background color roughly
    },
    dateBubble: {
        alignSelf: 'center',
        backgroundColor: '#E1E4E8',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginBottom: 16,
        marginTop: 8,
    },
    dateText: {
        fontSize: 11,
        color: '#555',
        fontWeight: '500',
    },
    messageBubbleReceived: {
        alignSelf: 'flex-start',
        backgroundColor: '#fff',
        borderRadius: 16,
        borderTopLeftRadius: 4,
        padding: 10,
        maxWidth: '80%',
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 1,
    },
    messageBubbleSent: {
        alignSelf: 'flex-end',
        backgroundColor: '#DCF8C6',
        borderRadius: 16,
        borderTopRightRadius: 4,
        padding: 10,
        maxWidth: '80%',
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 1,
    },
    messageText: {
        fontSize: 15,
        color: '#000',
        lineHeight: 20,
    },
    timeReceived: {
        fontSize: 10,
        color: '#8E8E93',
        alignSelf: 'flex-end',
        marginTop: 4,
    },
    sentStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 4,
        gap: 4,
    },
    timeSent: {
        fontSize: 10,
        color: '#8E8E93',
    },

    homeIndicatorContainer: {
        height: 34,
        backgroundColor: '#F6F6F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    homeIndicator: {
        width: 134,
        height: 5,
        backgroundColor: '#000',
        borderRadius: 2.5,
    },
    optionsContainer: {
        marginTop: 16,
        alignItems: 'flex-end',
        gap: 8,
    },
    optionBubble: {
        backgroundColor: '#fff',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: Colors.Primary100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 1,
    },
    optionText: {
        color: Colors.Primary100,
        fontSize: 14,
        fontWeight: '600',
    },
})
