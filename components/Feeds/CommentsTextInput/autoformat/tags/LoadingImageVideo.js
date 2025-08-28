import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import Spinner from '../../../../UIComponents/Spinner'
import { getPopoverWidth } from '../../../../../utils/HelperFunctions'
import { useSelector } from 'react-redux'
import { IMAGE_HEIGHT, IMAGE_HEIGHT_MOBILE, IMAGE_HEIGHT_TABLET } from './CustomImage'

export default function LoadingImageVideo() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const maxHeight = mobile ? IMAGE_HEIGHT_MOBILE : tablet ? IMAGE_HEIGHT_TABLET : IMAGE_HEIGHT
    const maxWidth = getPopoverWidth() - 64

    return (
        <View style={[localStyles.container, { width: maxWidth, height: maxHeight }]}>
            <View>
                <Spinner containerSize={64} spinnerSize={64} />
                <Icon name="upload" color="#B8BFC8" size={40} style={localStyles.icon} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Gray300,
        borderRadius: 8,
        alignContent: 'center',
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        position: 'absolute',
        left: 12,
        top: 12,
    },
})
