import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import HelperFunctions from '../../../../utils/HelperFunctions'

import styles, { colors } from '../../../styles/global'
import Avatar from '../../../Avatar'
import { translate } from '../../../../i18n/TranslationService'

export default function UserAvatarAndName({ userPayingId, userData, pending, firstPaymentDate }) {
    const { shortName, photoURL } = userData
    const invitingText = pending ? translate('is inviting you') : `${translate('invited you on')} ${firstPaymentDate}`
    const text = shortName + ' ' + invitingText
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Avatar
                avatarId={userPayingId}
                reviewerPhotoURL={photoURL}
                borderSize={0}
                externalStyle={localStyles.image}
            />
            <Text style={localStyles.name}>{text} </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    image: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: 4,
    },
    name: {
        ...styles.body2,
        color: colors.Text02,
    },
})
