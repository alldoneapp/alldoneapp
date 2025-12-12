import React from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, SafeAreaView, Dimensions } from 'react-native'
import Icon from '../Icon'
import Colors from '../../Themes/Colors'

const { width } = Dimensions.get('window')

export default function WebAppMockup({ onContinue, taskName = 'Prepare meeting with Claudia', style }) {
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

            {/* Web App Content */}
            <SafeAreaView style={styles.container}>
                <TouchableOpacity activeOpacity={0.9} onPress={onContinue} style={styles.touchableArea}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerLeft}>
                            <Icon name="menu" size={24} color={Colors.Text02} />
                            <View style={styles.coinContainer}>
                                <View style={styles.coinIcon}>
                                    <Icon name="star" size={10} color={Colors.White} style={{ marginTop: 1 }} />
                                </View>
                                <Text style={styles.coinText}>44k</Text>
                            </View>
                        </View>
                        <View style={styles.headerRight}>
                            <Icon name="search" size={20} color={Colors.Text03} style={styles.headerIcon} />
                            <Icon name="bell" size={20} color={Colors.Text03} />
                        </View>
                    </View>

                    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                        {/* Page Header */}
                        <View style={styles.pageHeader}>
                            <View style={styles.pageTitleRow}>
                                <Text style={styles.pageTitle}>Tasks</Text>
                                <Icon name="more-vertical" size={16} color={Colors.Text03} />
                            </View>
                            <View style={styles.filterRow}>
                                <View style={styles.openFilter}>
                                    <Icon name="square" size={12} color={Colors.Primary100} />
                                    <Text style={styles.openFilterText}>Open 4</Text>
                                </View>
                                <View style={styles.doneFilter}>
                                    <Icon name="check-square" size={14} color={Colors.Text03} />
                                    <Text style={styles.doneFilterText}>26</Text>
                                </View>
                            </View>
                        </View>

                        {/* All Projects Groups */}
                        <View style={styles.projectGroupHeader}>
                            <Image
                                source={{ uri: 'https://mystaging.alldone.app/images/generic-user.svg' }}
                                style={styles.avatarSmall}
                            />
                            <Text style={styles.projectGroupTitle}>All projects</Text>
                            <View style={{ flex: 1 }} />
                            <Icon name="check-circle" size={18} color={Colors.Text04} />
                        </View>

                        {/* Anna Card */}
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Anna Alldone: What can I do?</Text>
                            <View style={styles.aiInputRow}>
                                <Image
                                    source={{ uri: 'https://alldone.app/assets/images/marketing/anna-avatar.png' }}
                                    style={styles.annaAvatar}
                                />
                                <View style={styles.aiInput}>
                                    <Text style={styles.aiInputPlaceholder}>Chat with Anna...</Text>
                                </View>
                                <View style={styles.sendButton}>
                                    <Icon name="send" size={14} color={Colors.White} />
                                </View>
                            </View>
                        </View>

                        {/* Project Section */}
                        <View style={styles.projectSection}>
                            <View style={styles.projectHeader}>
                                <Icon name="icon-circle-poject_color" size={12} color={Colors.UtilityViolet300} />
                                <Text style={styles.projectTitle}>Alldone Product</Text>
                                <View style={{ flex: 1 }} />
                                <Icon name="check-circle" size={16} color={Colors.Text04} />
                            </View>

                            <View style={styles.sprintBadge}>
                                <Icon name="star" size={12} color={Colors.Primary100} />
                                <Text style={styles.sprintText}>31.12</Text>
                                <Text style={styles.sprintTitle}>AI Chief of Staff</Text>
                            </View>
                            <Text style={styles.projectStats}>57 Tasks · 19 Days Left</Text>

                            {/* Task List */}
                            <View style={styles.taskList}>
                                <Text style={styles.dateHeader}>TODAY • 3 TASKS</Text>

                                {/* Main Task (The one created in onboarding) */}
                                <View style={[styles.taskRow, styles.taskRowHighlighted]}>
                                    <View style={styles.taskCheckbox} />
                                    <View style={styles.taskContent}>
                                        <Text style={styles.taskText} numberOfLines={2}>
                                            {taskName}
                                        </Text>
                                        <View style={styles.taskMeta}>
                                            <View style={[styles.tag, { backgroundColor: '#E3F2FD' }]}>
                                                <Icon name="file-text" size={10} color={Colors.Primary100} />
                                                <Text style={[styles.tagText, { color: Colors.Primary100 }]}>
                                                    onboarding
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </View>

                                {/* Other dummy tasks */}
                                <View style={styles.taskRow}>
                                    <View style={styles.taskCheckbox} />
                                    <View style={styles.taskContent}>
                                        <Text style={styles.taskText} numberOfLines={2}>
                                            Onboarding: allow selecting monthly or yearly Stripe plan
                                        </Text>
                                        <View style={styles.taskMeta}>
                                            <Icon name="info" size={12} color={Colors.Text04} />
                                            <Text style={styles.taskMetaText}>AT-519</Text>
                                        </View>
                                    </View>
                                </View>
                            </View>
                        </View>
                    </ScrollView>

                    {/* Continue Overlay Button */}
                    <View style={styles.overlayButtonContainer}>
                        <TouchableOpacity style={styles.continueButton} onPress={onContinue}>
                            <Text style={styles.continueButtonText}>Continue</Text>
                            <Icon name="arrow-right" size={16} color={Colors.White} style={{ marginLeft: 8 }} />
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </SafeAreaView>

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
        backgroundColor: Colors.White,
        borderBottomWidth: 1,
        borderBottomColor: Colors.Grey200,
    },
    timeText: { fontSize: 13, fontWeight: '600', color: '#000' },
    statusIcons: { flexDirection: 'row', alignItems: 'center' },
    signalIcon: { width: 14, height: 9, backgroundColor: '#000', borderRadius: 2, marginRight: 4 },
    wifiIcon: { width: 14, height: 9, backgroundColor: '#000', borderRadius: 4, marginRight: 4 },
    batteryIcon: { width: 18, height: 9, borderWidth: 1, borderColor: '#000', borderRadius: 2 },
    homeIndicatorContainer: {
        height: 34,
        backgroundColor: Colors.White,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: 1,
        borderTopColor: Colors.Grey200,
    },
    homeIndicator: { width: 100, height: 4, backgroundColor: '#000', borderRadius: 2 },
    container: {
        flex: 1,
        backgroundColor: '#F7F9FC',
    },
    touchableArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: Colors.White,
        borderBottomWidth: 1,
        borderBottomColor: Colors.Grey300,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    coinContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.White,
        borderWidth: 1,
        borderColor: Colors.Grey300,
        borderRadius: 12,
        paddingHorizontal: 6,
        paddingVertical: 3,
        marginLeft: 8,
    },
    coinIcon: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#FFC107',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 4,
    },
    coinText: {
        fontSize: 10,
        fontWeight: '600',
        color: Colors.Text02,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerIcon: {
        marginRight: 12,
    },
    content: {
        flex: 1,
    },
    pageHeader: {
        padding: 12,
        backgroundColor: Colors.White,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pageTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pageTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: Colors.Text01,
        marginRight: 4,
    },
    filterRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    openFilter: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF5FF',
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 4,
        marginRight: 6,
    },
    openFilterText: {
        fontSize: 10,
        color: Colors.Primary100,
        fontWeight: '600',
        marginLeft: 2,
    },
    doneFilter: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.Grey200,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 4,
    },
    doneFilterText: {
        fontSize: 10,
        color: Colors.Text03,
        marginLeft: 2,
    },
    projectGroupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    avatarSmall: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: 6,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: Colors.Text01,
    },
    card: {
        marginHorizontal: 12,
        marginBottom: 16,
        backgroundColor: Colors.White,
        borderRadius: 8,
        padding: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        borderWidth: 1,
        borderColor: Colors.Grey300,
    },
    cardTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: Colors.Text01,
        marginBottom: 8,
    },
    aiInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    annaAvatar: {
        width: 24,
        height: 24,
        borderRadius: 6,
        marginRight: 6,
    },
    aiInput: {
        flex: 1,
        backgroundColor: Colors.White,
        borderWidth: 1,
        borderColor: Colors.Grey300,
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        marginRight: 6,
        justifyContent: 'center',
    },
    aiInputPlaceholder: {
        color: Colors.Text03,
        fontSize: 11,
    },
    sendButton: {
        width: 24,
        height: 24,
        backgroundColor: Colors.Primary200,
        borderRadius: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    projectSection: {
        backgroundColor: Colors.White,
        padding: 12,
        paddingBottom: 60, // Space for continue button
    },
    projectHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    projectTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: Colors.Text01,
        marginLeft: 6,
    },
    sprintBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
        backgroundColor: '#EBF5FF',
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    sprintText: {
        color: Colors.Primary100,
        fontWeight: '700',
        fontSize: 11,
        marginLeft: 4,
        marginRight: 6,
    },
    sprintTitle: {
        color: Colors.Text02,
        fontSize: 11,
        fontWeight: '500',
    },
    projectStats: {
        fontSize: 10,
        color: Colors.Text03,
        marginBottom: 12,
    },
    taskList: {
        borderTopWidth: 1,
        borderTopColor: Colors.Grey200,
        paddingTop: 12,
    },
    dateHeader: {
        fontSize: 9,
        fontWeight: '700',
        color: Colors.Text03,
        marginBottom: 8,
        letterSpacing: 0.5,
    },
    taskRow: {
        flexDirection: 'row',
        marginBottom: 12,
        backgroundColor: Colors.White,
        borderWidth: 1,
        borderColor: Colors.Grey300,
        borderRadius: 4,
        padding: 2,
    },
    taskRowHighlighted: {
        borderColor: Colors.Primary100,
        backgroundColor: '#F7FBFF',
    },
    taskCheckbox: {
        width: 16,
        height: 16,
        borderWidth: 1.5,
        borderColor: Colors.Text03,
        borderRadius: 4,
        margin: 8,
        marginTop: 10,
    },
    taskContent: {
        flex: 1,
        paddingVertical: 6,
        paddingRight: 6,
    },
    taskText: {
        fontSize: 12,
        color: Colors.Text01,
        marginBottom: 4,
        fontWeight: '500',
        lineHeight: 16,
    },
    taskMeta: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 3,
        marginRight: 4,
    },
    tagText: {
        fontSize: 9,
        marginLeft: 2,
        fontWeight: '500',
    },
    taskMetaText: {
        fontSize: 9,
        color: Colors.Text03,
        marginRight: 4,
    },
    overlayButtonContainer: {
        position: 'absolute',
        bottom: 16,
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    continueButton: {
        backgroundColor: Colors.Primary100,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 24,
        borderRadius: 24,
        shadowColor: Colors.Primary100,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    continueButtonText: {
        color: Colors.White,
        fontSize: 14,
        fontWeight: '600',
    },
})
