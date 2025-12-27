import React from 'react'
import { StyleSheet, View, Text, TouchableOpacity, Modal } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import { setIframeModalData } from '../../../../redux/actions'

export default function IframeModal() {
    const dispatch = useDispatch()
    const iframeModalData = useSelector(state => state.iframeModalData)
    const { visible, url } = iframeModalData

    if (!visible) return null

    const closeModal = () => {
        dispatch(setIframeModalData(false, ''))
    }

    // Extract domain from URL for display
    const getDomainFromUrl = urlStr => {
        try {
            const urlObj = new URL(urlStr)
            return urlObj.hostname
        } catch {
            return urlStr
        }
    }

    return (
        <View style={localStyles.overlay}>
            <View style={localStyles.container}>
                <View style={localStyles.header}>
                    <View style={localStyles.headerLeft}>
                        <Icon name="monitor" size={18} color={colors.Text03} />
                        <Text style={localStyles.headerTitle} numberOfLines={1}>
                            {getDomainFromUrl(url)}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={closeModal} style={localStyles.closeButton}>
                        <Icon name="x" size={20} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={localStyles.content}>
                    <iframe
                        src={url}
                        style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                        }}
                        title="Task Iframe"
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
    },
    container: {
        width: '96%',
        height: '96%',
        maxWidth: 1600,
        maxHeight: 1200,
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 24,
    },
    header: {
        height: 44,
        backgroundColor: '#1a1a2e',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 16,
    },
    headerTitle: {
        color: colors.Text03,
        fontSize: 14,
        marginLeft: 10,
        flex: 1,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        backgroundColor: '#fff',
    },
})
