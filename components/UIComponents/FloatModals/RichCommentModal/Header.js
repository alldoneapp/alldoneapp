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
        marginBottom: 20,
        width: '100%',
    },
    titleText: {
        lineHeight: 20,
    },
})
