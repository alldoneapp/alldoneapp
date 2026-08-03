import React from 'react'
import { Image, Text, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

const UserTag = ({ user, onlyPhoto = false }) => {
    const label = user.displayName || translate('Loading')

    return (
        <View accessibilityLabel={onlyPhoto ? label : undefined} title={onlyPhoto ? label : undefined}>
            <Text style={localStyles.textContainer}>
                <View style={[localStyles.container, onlyPhoto && { paddingRight: 2 }]}>
                    <Image style={localStyles.userImage} source={{ uri: user.photoURL }} />
                    {!onlyPhoto && (
                        <View style={{ paddingLeft: 4 }}>
                            <Text style={[styles.subtitle2, { color: colors.Text03 }, windowTagStyle()]}>
                                {user.displayName ? label.split(' ')[0] : label}
                            </Text>
                        </View>
                    )}
                </View>
            </Text>
        </View>
    )
}
export default UserTag

const localStyles = {
    textContainer: {
        display: 'flex',
        alignItems: 'center',
    },
    userImage: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        paddingRight: 10,
        paddingLeft: 2,
        height: 24,
    },
}
