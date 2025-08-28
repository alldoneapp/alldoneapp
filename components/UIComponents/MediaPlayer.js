import React, { useEffect, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { colors } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import {
    IMAGE_HEIGHT,
    IMAGE_HEIGHT_MOBILE,
    IMAGE_HEIGHT_TABLET,
} from '../Feeds/CommentsTextInput/autoformat/tags/CustomImage'
import { getFileSize, getPopoverWidth } from '../../utils/HelperFunctions'
import { checkIsLimitedByTraffic, PLAN_STATUS_FREE } from '../Premium/PremiumHelper'
import useTrafficQuota from '../../hooks/useTrafficQuota'

export default function MediaPlayer({ projectId, src }) {
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const { uid, premium } = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const limitedByTraffic = useTrafficQuota(projectId)

    const [isPaused, setIsPaused] = useState(true)
    const targetHeight = mobile ? IMAGE_HEIGHT_MOBILE : tablet ? IMAGE_HEIGHT_TABLET : IMAGE_HEIGHT

    const checkIsLimited = () => {
        checkIsLimitedByTraffic(projectId)
    }

    const onLayout = ({ nativeEvent }) => {
        const width = nativeEvent.layout.width
        if (width < dimension.width) {
            setDimension({ height: (width / dimension.width) * dimension.height, width: width - 1 })
        }
    }

    const getDimensions = customWidth => {
        const initialWidth = customWidth || targetHeight.width
        const newWidth =
            targetHeight.height > targetHeight ? (targetHeight / targetHeight.height) * initialWidth : initialWidth
        return { width: newWidth, height: targetHeight }
    }

    useEffect(() => {
        if (!virtualQuillLoaded) {
            setDimension(getDimensions())
        }
    }, [mobile, tablet])

    const [dimension, setDimension] = useState(getDimensions(getPopoverWidth() - 60))

    return (
        <View style={{ width: 'fit-content' }} onLayout={onLayout}>
            <View
                style={[
                    localStyles.mask,
                    {
                        height: dimension.height,
                        width: dimension.width,
                    },
                ]}
            >
                {isPaused && (
                    <View style={localStyles.button}>
                        <View style={localStyles.play} />
                        <Icon name="play" size={28} color={'#fff'} style={localStyles.icon} />
                    </View>
                )}
                <TouchableOpacity style={isPaused && localStyles.video} onPress={checkIsLimited} activeOpacity={1}>
                    <video
                        onPlay={() => {
                            setIsPaused(false)
                            premium.status === PLAN_STATUS_FREE && getFileSize(projectId, src, uid)
                        }}
                        onPause={() => setIsPaused(true)}
                        height="205"
                        width="100%"
                        controls={!limitedByTraffic}
                        playsInline
                        src={src}
                        style={{ borderRadius: 8 }}
                        onContextMenu={e => (limitedByTraffic ? e.preventDefault() : false)}
                    />
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    mask: {
        borderRadius: 8,
        overflow: 'hidden',
        justifyContent: 'center',
    },
    button: {
        alignSelf: 'center',
        justifyContent: 'center',
        position: 'absolute',
    },
    play: {
        height: 40,
        width: 40,
        borderRadius: 100,
        backgroundColor: colors.Primary100,
        position: 'absolute',
        alignSelf: 'center',
        justifyContent: 'center',
    },
    video: {
        opacity: 0.8,
        backgroundColor: colors.Primary100,
    },
    icon: {
        position: 'absolute',
        alignSelf: 'center',
        marginLeft: 4,
    },
})
