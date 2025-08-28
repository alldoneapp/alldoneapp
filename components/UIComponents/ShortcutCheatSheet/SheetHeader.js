import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import SVGShortcutIcon from '../../../assets/svg/SVGShortcutIcon'
import styles, { colors, em2px } from '../../styles/global'
import MyPlatform from '../../MyPlatform'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export default function SheetHeader(props) {
    const { osType } = MyPlatform

    return (
        <View style={localStyles.container}>
            <SVGShortcutIcon />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.bigText}>{translate('Shortcuts cheat sheet')}</Text>
                <View style={localStyles.partTwo}>
                    <Text style={[localStyles.smallText, { marginHorizontal: 4 }]}>•</Text>
                    <Text style={localStyles.smallText}>{translate('Just press')}</Text>
                    <View style={localStyles.questionKey}>
                        {osType === 'mac' ? (
                            <View style={{ flexDirection: 'row' }}>
                                <Icon
                                    name={'option-key'}
                                    size={14}
                                    color={colors.Secondary400}
                                    style={{ marginRight: 2 }}
                                />
                                <Text style={localStyles.questionText}>+?</Text>
                            </View>
                        ) : (
                            <Text style={localStyles.questionText}>Alt+?</Text>
                        )}
                    </View>
                    <Text style={localStyles.smallText}>{translate('or')}</Text>
                    <View style={localStyles.questionKey}>
                        {osType === 'mac' ? (
                            <View style={{ flexDirection: 'row' }}>
                                <Icon
                                    name={'option-key'}
                                    size={14}
                                    color={colors.Secondary400}
                                    style={{ marginRight: 2 }}
                                />
                                <Text style={localStyles.questionText}>+/</Text>
                            </View>
                        ) : (
                            <Text style={localStyles.questionText}>Alt+/</Text>
                        )}
                    </View>
                    <Text style={localStyles.smallText}>{translate('to display it')}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    textContainer: {
        flexDirection: 'row',
        marginLeft: 8,
    },
    partTwo: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    questionKey: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 4,
        height: 16,
        paddingHorizontal: 5,
        marginHorizontal: 6,
        bottom: 6,
    },
    questionText: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
        color: colors.Secondary400,
    },
    bigText: {
        ...styles.title4,
        color: '#ffffff',
    },
    smallText: {
        ...styles.body1,
        color: '#ffffff',
    },
})
