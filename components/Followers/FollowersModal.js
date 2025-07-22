import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, em2px } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import HelperFunctions, { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../utils/HelperFunctions'
import useWindowSize from '../../utils/useWindowSize'
import CustomScrollView from '../UIControls/CustomScrollView'

export default function FollowersModal({ closeModal, followers, markAssignee = false, followObjectsType }) {
    const [width, height] = useWindowSize()
    const assignee = useSelector(state => state.assignee)
    const showAssignee = markAssignee && assignee && assignee.uid

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Text style={localStyles.title}>Followers</Text>
                <Text style={localStyles.subtitle}>
                    List of all the users following this {followObjectsType.slice(0, -1)}
                </Text>
                {followers.map(user => (
                    <View style={localStyles.followerContainer} key={user.uid}>
                        <Image
                            style={[
                                localStyles.followerAvatar,
                                showAssignee && assignee.uid === user.uid && localStyles.followerAssignee,
                            ]}
                            source={{ uri: user.photoURL }}
                        />
                        <View style={{ flexDirection: 'row' }}>
                            <Text style={localStyles.followerName}>
                                {HelperFunctions.getFirstName(user.displayName)}
                            </Text>
                            {showAssignee && assignee.uid === user.uid && (
                                <Text style={localStyles.assigneeMark}>Assignee</Text>
                            )}
                        </View>
                    </View>
                ))}
                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closeModal}>
                        <Icon name="x" size={24} color={colors.Text02} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        width: 298,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        paddingBottom: 8,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 20,
    },
    followerContainer: {
        flexDirection: 'row',
        height: 48,
        alignItems: 'center',
    },
    followerAvatar: {
        width: 32,
        height: 32,
        borderRadius: 100,
    },
    followerAssignee: {
        borderWidth: 3,
        borderColor: colors.Primary200,
    },
    followerName: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
    assigneeMark: {
        ...styles.caption1,
        letterSpacing: em2px(0.03),
        color: colors.Primary100,
        marginLeft: 12,
        alignSelf: 'flex-end',
        paddingBottom: 1,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
