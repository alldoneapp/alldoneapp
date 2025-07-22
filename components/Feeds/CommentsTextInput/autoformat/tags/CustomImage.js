import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'
import WildcardImage from './WildcardImage'
import { useSelector } from 'react-redux'
import { getFileSize } from '../../../../../utils/HelperFunctions'
import { checkIsLimitedByTraffic, PLAN_STATUS_FREE } from '../../../../Premium/PremiumHelper'
import useTrafficQuota from '../../../../../hooks/useTrafficQuota'

export const IMAGE_HEIGHT = 200
export const IMAGE_HEIGHT_TABLET = 150
export const IMAGE_HEIGHT_MOBILE = 100

export default function CustomImage({ projectId, uri, resizedUri, maxWidth }) {
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const { uid, premium } = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const targetHeight = mobile ? IMAGE_HEIGHT_MOBILE : tablet ? IMAGE_HEIGHT_TABLET : IMAGE_HEIGHT
    const [opacity, setOpacity] = useState(0)
    const [dimensions, setDimensions] = useState({ width: 0, height: 200 })
    const limitedByTraffic = useTrafficQuota(projectId)

    const openImage = () => {
        if (!checkIsLimitedByTraffic(projectId)) {
            window.open(uri, '_blank')
            premium.status === PLAN_STATUS_FREE && getFileSize(projectId, uri, uid)
        }
    }

    const getDimensions = (width, height) => {
        if (maxWidth) {
            width !== maxWidth ? resizeImage(width, height, true) : setDimensions({ width, height })
        } else {
            height !== targetHeight ? resizeImage(width, height) : setDimensions({ width, height })
        }
    }

    const resizeImage = (width, height, fitWidth = false) => {
        if (fitWidth) {
            let ratio = 0
            let newHeight = height
            let newWidth = width

            if (newWidth > newHeight) {
                ratio = maxWidth / newWidth
                newHeight = newHeight * ratio
                newWidth = newWidth * ratio
            }

            if (newHeight > targetHeight) {
                ratio = targetHeight / newHeight
                newHeight = newHeight * ratio
                newWidth = newWidth * ratio
            }

            setDimensions({ width: newWidth, height: newHeight })
        } else {
            const newWidth = height > targetHeight ? (targetHeight / height) * width : width
            setDimensions({ width: newWidth, height: targetHeight })
        }
    }

    useEffect(() => {
        if (!virtualQuillLoaded) {
            Image.getSize(resizedUri, getDimensions, onError)
        }
    }, [maxWidth, mobile, tablet])

    const onError = () => {
        setOpacity(1)
    }

    return dimensions.width > 0 ? (
        <View style={[localStyles.parent, { maxHeight: targetHeight }]}>
            <View style={[localStyles.container, { maxHeight: targetHeight }, dimensions]}>
                <Image
                    source={{ uri: resizedUri }}
                    style={[localStyles.image, { maxHeight: targetHeight }, dimensions]}
                    onContextMenu={e => (limitedByTraffic ? e.preventDefault() : false)}
                />
                <TouchableOpacity
                    onPress={openImage}
                    onClick={e => {
                        e.stopPropagation()
                    }}
                    style={localStyles.button}
                >
                    <Icon name="maximize-3" color="#ffffff" size={16} />
                </TouchableOpacity>
            </View>
        </View>
    ) : (
        <View style={[localStyles.container, { opacity }]}>
            <WildcardImage />
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        display: 'table',
        flexBasis: 'auto',
        minHeight: 80,
        width: '100%',
        minWidth: 80,
        overflow: 'hidden',
    },
    container: {
        flex: 1,
        position: 'relative',
        display: 'table',
        minHeight: 80,
        minWidth: 80,
        backgroundColor: colors.Gray300,
        borderRadius: 8,
        overflow: 'hidden',
    },
    image: {
        flex: 1,
    },
    button: {
        padding: 4,
        position: 'absolute',
        borderRadius: 4,
        height: 24,
        width: 24,
        top: 8,
        right: 8,
        backgroundColor: colors.Primary400,
    },
})
