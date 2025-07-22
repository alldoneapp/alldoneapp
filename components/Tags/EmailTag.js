import { useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import React from 'react'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import { getCustomStyle } from '../../utils/HelperFunctions'

export default function EmailTag({
    address,
    inTaskDV,
    style,
    tagStyle,
    useCommentTagStyle,
    disabled,
    iconSize,
    tagContainerStyle,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const textLimit = mobile ? 15 : tablet ? 20 : 25

    const feedCommentStyle = () => {
        return useCommentTagStyle ? { ...styles.caption1 } : {}
    }

    const getTextStyle = () => {
        const finalStyle =
            style != null ? { ...detailedViewStyle, ...style } : { ...styles.subtitle2, ...detailedViewStyle }

        return { ...finalStyle, ...feedCommentStyle(), textDecoration: 'none', lineHeight: 0, color: colors.Yellow300 }
    }

    const detailedViewStyle = inTaskDV ? { ...styles.title6 } : {}
    return (
        <View>
            <TouchableOpacity
                onClick={e => {
                    // Linking.openURL(`mailto:${address}?subject=Change me!`)
                    e.stopPropagation()
                }}
            >
                <Text style={[localStyles.centeredFlex, tagStyle]}>
                    <View
                        style={[
                            localStyles.mailContainer,
                            getCustomStyle(inTaskDV, null, useCommentTagStyle),
                            tagContainerStyle,
                        ]}
                    >
                        <Icon
                            size={iconSize || (inTaskDV ? 18 : useCommentTagStyle ? 14 : 16)}
                            name="mail"
                            color={colors.Yellow300}
                        />
                        <View
                            style={[
                                localStyles.mailSubView,
                                inTaskDV && { paddingLeft: 7 },
                                !inTaskDV && windowTagStyle(),
                            ]}
                            pointerEvents={disabled ? 'none' : 'auto'}
                        >
                            <a
                                style={getTextStyle()}
                                href={`mailto:${address}?subject=Change me!`}
                                target="_blank"
                                underline="false"
                                onClick={e => {
                                    // e.stopPropagation()
                                    //  e.preventDefault()
                                }}
                            >
                                {shrinkTagText(address, textLimit)}
                            </a>
                        </View>
                    </View>
                </Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    centeredFlex: {
        display: 'flex',
        alignItems: 'center',
    },
    mailContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Yellow125,
        borderRadius: 50,
        paddingRight: 8,
        paddingLeft: 4,
    },
    mailSubView: {
        paddingLeft: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
