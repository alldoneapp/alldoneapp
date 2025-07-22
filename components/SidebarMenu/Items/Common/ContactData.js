import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import UserName from './UserName'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import HelperFunctions from '../../../../utils/HelperFunctions'

export default function ContactData({ contact }) {
    const { expanded } = useCollapsibleSidebar()
    const { photoURL, uid, displayName } = contact

    return (
        <View style={localStyles.container}>
            {!photoURL ? (
                <View style={[localStyles.image, localStyles.avatar, { marginRight: expanded ? 10 : 2 }]}>
                    <SVGGenericUser width={20} height={20} svgid={`ci_p_${contact.uid}`} />
                </View>
            ) : (
                <Image source={{ uri: photoURL }} style={[localStyles.image, { marginRight: expanded ? 10 : 2 }]} />
            )}

            {expanded && (
                <UserName
                    userId={uid}
                    name={HelperFunctions.getFirstName(displayName)}
                    containerStyle={{ marginRight: 5 }}
                />
            )}
            <Icon name="user-aster" size={12} color={colors.Text03} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    image: {
        height: 20,
        width: 20,
        borderRadius: 100,
    },
    avatar: {
        overflow: 'hidden',
    },
})
