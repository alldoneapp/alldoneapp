import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import { colors, em2px } from '../../styles/global'
import MyPlatform from '../../MyPlatform'

export default function ShortcutTag({ windowShortcut, macShortcut, style }) {
    const { osType } = MyPlatform

    const getSpaceStyle = (index, length) => {
        if (index === 0 && length > 1) return localStyles.spaceRight
        if (index === length - 1 && length > 1) return localStyles.spaceLeft
        if (0 < index && index < length - 1) return localStyles.spaceBoth
        return null
    }

    const mapCharsToIcons = (char, key, style) => {
        const mapping = {
            '<|': <Icon key={key} name={'arrow-left-symbol'} size={14} color={colors.Secondary400} style={style} />,
            '|>': <Icon key={key} name={'arrow-right-symbol'} size={14} color={colors.Secondary400} style={style} />,
            '^|': <Icon key={key} name={'arrow-up-symbol'} size={14} color={colors.Secondary400} style={style} />,
            '|-': <Icon key={key} name={'arrow-down-symbol'} size={14} color={colors.Secondary400} style={style} />,
            '#': <Icon key={key} name={'command'} size={14} color={colors.Secondary400} style={style} />,
            '/=': <Icon key={key} name={'option-key'} size={14} color={colors.Secondary400} style={style} />,
            '/_': (
                <Text key={key} style={localStyles.text}>
                    {' '}
                </Text>
            ),
        }
        if (mapping.hasOwnProperty(char)) {
            return mapping[char]
        } else {
            return (
                <Text key={key} style={localStyles.text}>
                    {char}
                </Text>
            )
        }
    }

    const parseShortcut = text => {
        const chunks = text.split(' ')
        return chunks.map((item, i) => mapCharsToIcons(item, i, getSpaceStyle(i, chunks.length)))
    }

    return (
        <View style={[localStyles.container, style]}>
            {parseShortcut(osType === 'mac' && macShortcut != null ? macShortcut : windowShortcut)}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        backgroundColor: colors.Grey300,
        height: 24,
        paddingVertical: 5,
        paddingHorizontal: 8,
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
        color: colors.Secondary400,
    },
    spaceLeft: {
        marginLeft: 2,
    },
    spaceRight: {
        marginRight: 2,
    },
    spaceBoth: {
        marginHorizontal: 2,
    },
})
