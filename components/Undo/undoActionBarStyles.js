import { Platform, StatusBar, StyleSheet } from 'react-native'

import { colors } from '../styles/global'

const undoActionBarStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
        zIndex: 100000,
        alignItems: 'center',
    },
    viewport: {
        // SafeAreaView's web styles use paddingLeft/paddingRight, which override paddingHorizontal.
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    mobileViewport: {
        paddingHorizontal: 24,
    },
    container: {
        marginTop: 64,
        minHeight: 48,
        maxWidth: 560,
        width: '100%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: colors.Text01,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
    },
    dismissArea: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        borderRadius: 8,
    },
    message: {
        color: '#FFFFFF',
        flex: 1,
        marginRight: 16,
    },
    action: {
        color: colors.UtilityBlue200,
    },
})

export default undoActionBarStyles
