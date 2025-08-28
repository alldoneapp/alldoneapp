import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { HASHTAG_COLOR_MAPPING } from '../NotesView/NotesDV/EditorView/HashtagInteractionPopup/HashtagsInteractionPopup'
import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

export default function TagItem({ text, colorKey, onPress, containerStyle }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const cleanedText = text.substr(1)
    const textLimit = smallScreenNavigation ? 15 : isMiddleScreen ? 20 : 25

    return (
        <View
            style={[
                localStyles.container,
                containerStyle,
                { backgroundColor: HASHTAG_COLOR_MAPPING[colorKey].tagBack },
            ]}
        >
            <TouchableOpacity
                style={localStyles.innerContainer}
                onPress={onPress}
                onClick={e => e.stopPropagation()}
                accessible={false}
            >
                <Icon size={16} name={'hash'} color={HASHTAG_COLOR_MAPPING[colorKey].tagText} />
                <View style={localStyles.text}>
                    <Text
                        style={[styles.subtitle2, { color: HASHTAG_COLOR_MAPPING[colorKey].tagText }, windowTagStyle()]}
                    >
                        {shrinkTagText(cleanedText, textLimit)}
                    </Text>
                </View>
                <Icon size={16} name={'x-circle'} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
    },
    innerContainer: {
        height: 24,
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    text: {
        marginLeft: 0,
        marginRight: 12,
    },
})
