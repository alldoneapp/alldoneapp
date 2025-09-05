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
            <div style={styles.appShell}>
                <div style={styles.header}>
                    <div style={styles.logo}></div>
                    <div style={styles.nav}>
                        <div style={styles.navItem}></div>
                        <div style={styles.navItem}></div>
                        <div style={styles.navItem}></div>
                    </div>
                </div>
                <div style={styles.sidebar}>
                    <div style={styles.sidebarItem}></div>
                    <div style={styles.sidebarItem}></div>
                    <div style={styles.sidebarItem}></div>
                </div>
                <div style={styles.content}>{children}</div>
            </div>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    appShell: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
    },
    header: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: '60px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #e9ecef',
        padding: '0 20px',
    },
    logo: {
        width: '120px',
        height: '30px',
        backgroundColor: '#e9ecef',
        borderRadius: '4px',
        marginRight: '40px',
    },
    nav: {
        display: 'flex',
        flexDirection: 'row',
        gap: '20px',
    },
    navItem: {
        width: '80px',
        height: '20px',
        backgroundColor: '#dee2e6',
        borderRadius: '4px',
    },
    sidebar: {
        position: 'absolute',
        left: 0,
        top: '60px',
        bottom: 0,
        width: '250px',
        backgroundColor: '#f8f9fa',
        borderRight: '1px solid #e9ecef',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    sidebarItem: {
        width: '100%',
        height: '40px',
        backgroundColor: '#dee2e6',
        borderRadius: '6px',
    },
    content: {
        marginLeft: '250px',
        marginTop: '60px',
        flex: 1,
        padding: '20px',
        overflow: 'auto',
    },
})

export default AppShell
