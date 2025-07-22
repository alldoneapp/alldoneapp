import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import ChatHeaderMemeber from './ChatHeaderMemeber'

const ChatHeaderItem = ({ members, membersNumber }) => {
    const userId1 = members[membersNumber - 1]
    const userId2 = members[membersNumber - 2]
    const userId3 = members[membersNumber - 3]

    return (
        <>
            {(() => {
                switch (membersNumber) {
                    case 1:
                        return (
                            <View style={localStyles.container}>
                                <ChatHeaderMemeber memberId={userId1} photoStyle={localStyles.userImage} />
                            </View>
                        )
                    case 2:
                        return (
                            <View style={localStyles.container}>
                                <ChatHeaderMemeber memberId={userId1} photoStyle={localStyles.userImage2} />
                                <ChatHeaderMemeber memberId={userId2} photoStyle={localStyles.userImage21} />
                            </View>
                        )
                    default:
                        return (
                            <View style={localStyles.container3}>
                                <View style={{ flexDirection: 'row' }}>
                                    <ChatHeaderMemeber memberId={userId1} photoStyle={localStyles.userImage3} />
                                    <ChatHeaderMemeber memberId={userId2} photoStyle={localStyles.userImage3} />
                                </View>
                                <View style={{ flexDirection: 'row' }}>
                                    <ChatHeaderMemeber memberId={userId3} photoStyle={localStyles.userImage3} />
                                    {membersNumber > 3 && (
                                        <View style={localStyles.ellipse}>
                                            <Text style={[styles.caption1, { color: colors.Text02 }]}>
                                                +{membersNumber - 3}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )
                }
            })()}
        </>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginRight: 16,
        alignItems: 'center',
        width: 48,
    },
    userImage: {
        width: 44,
        height: 44,
        borderRadius: 100,
    },

    userImage2: {
        alignSelf: 'flex-start',
        width: 28,
        height: 28,
        borderRadius: 100,
    },
    userImage21: {
        alignSelf: 'flex-end',
        width: 28,
        height: 28,
        borderRadius: 100,
        marginTop: -8,
    },

    container3: {
        marginRight: 16,
        width: 48,
    },
    userImage3: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },

    ellipse: {
        width: 24,
        height: 24,
        borderRadius: 100,
        backgroundColor: colors.Gray300,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatar: {
        borderRadius: 100,
    },
})

export default ChatHeaderItem
