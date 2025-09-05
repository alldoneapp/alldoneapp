import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import ProgressiveLoadingScreen from './ProgressiveLoadingScreen'

const AppShell = ({ loadingStep, loadingMessage, children }) => {
    if (loadingStep > 0 && loadingStep < 5) {
        return (
            <View style={styles.container}>
                <ProgressiveLoadingScreen step={loadingStep} totalSteps={5} currentMessage={loadingMessage} />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.appShell}>
                <View style={styles.header}>
                    <View style={styles.logo} />
                    <View style={styles.nav}>
                        <View style={styles.navItem} />
                        <View style={styles.navItem} />
                        <View style={styles.navItem} />
                    </View>
                </View>
                <View style={styles.sidebar}>
                    <View style={styles.sidebarItem} />
                    <View style={styles.sidebarItem} />
                    <View style={styles.sidebarItem} />
                </View>
                <View style={styles.content}>{children}</View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    appShell: {
        flex: 1,
        flexDirection: 'column',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 60,
        backgroundColor: '#f8f9fa',
        borderBottomWidth: 1,
        borderBottomColor: '#e9ecef',
        paddingHorizontal: 20,
    },
    logo: {
        width: 120,
        height: 30,
        backgroundColor: '#e9ecef',
        borderRadius: 4,
        marginRight: 40,
    },
    nav: {
        flexDirection: 'row',
    },
    navItem: {
        width: 80,
        height: 20,
        backgroundColor: '#dee2e6',
        borderRadius: 4,
        marginRight: 20,
    },
    sidebar: {
        position: 'absolute',
        left: 0,
        top: 60,
        bottom: 0,
        width: 250,
        backgroundColor: '#f8f9fa',
        borderRightWidth: 1,
        borderRightColor: '#e9ecef',
        padding: 20,
    },
    sidebarItem: {
        width: '100%',
        height: 40,
        backgroundColor: '#dee2e6',
        borderRadius: 6,
        marginBottom: 16,
    },
    content: {
        marginLeft: 250,
        marginTop: 60,
        flex: 1,
        padding: 20,
    },
})

export default AppShell
