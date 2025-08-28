import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function DeleteContentItem({ userId, selectedUserId, setSelectedUserId, inProgress }) {
    return (
        <TouchableOpacity style={localStyles.container} onPress={() => setSelectedUserId(userId)} disabled={inProgress}>
            <View style={localStyles.deleteContentButton}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="trash-2" size={24} color="white" />
                    <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]}>
                        {translate('Delete user content also')}
                    </Text>
                </View>
                {selectedUserId === userId && <Icon name="check" size={24} color="white" />}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        width: '100%',
    },
    deleteContentButton: {
        height: 40,
        paddingVertical: 8,
        marginTop: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
})
