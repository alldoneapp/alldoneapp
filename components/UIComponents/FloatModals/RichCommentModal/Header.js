import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ObjectHeaderParser from '../../../Feeds/TextParser/ObjectHeaderParser'

export default function Header({ title }) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const text = title || translate('Comment')

    return (
        <View style={localStyles.headingContainer}>
            <ObjectHeaderParser
                text={text}
                containerExternalStyle={localStyles.titleParser}
                entryExternalStyle={[
                    styles.title7,
                    {
                        color: '#ffffff',
                    },
                    localStyles.titleText,
                ]}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    headingContainer: {
        // The title and the explanatory line under it are one block, matching the
        // "No comments yet" empty-state card in RichCommentModal (AT-2528).
        marginBottom: 4,
        width: '100%',
    },
    titleParser: {
        // ObjectHeaderParser indents itself by 12 because in a feed row it sits beside an
        // avatar. The cards that render this header supply their own padding, so that
        // margin would push the title 12px further right than the text below it (AT-2528).
        marginLeft: 0,
    },
    titleText: {
        lineHeight: 20,
    },
})
