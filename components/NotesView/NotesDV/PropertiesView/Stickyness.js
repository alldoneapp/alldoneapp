import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import StickynessPicker from './StickynessPicker'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

const Stickyness = ({ projectId, note, disabled, isChat }) => (
    <View style={localStyles.container}>
        <View style={{ marginRight: 8 }}>
            <Icon name="sticky-note" size={24} color={colors.Text03} />
        </View>
        <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Sticky')}</Text>
        <View style={{ marginLeft: 'auto' }}>
            <StickynessPicker projectId={projectId} note={note} disabled={disabled} isChat={isChat} />
        </View>
    </View>
)

export default Stickyness

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
