import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import SkillsDefaultPrivacyWrapper from './SkillsDefaultPrivacyWrapper'
import { updateDefaultSkillsPrivacy } from '../../../../../utils/backends/Skills/skillsFirestore'

export default function SkillsDefaultPrivacy({ projectId }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const savePrivacy = (isPrivate, isPublicFor) => {
        updateDefaultSkillsPrivacy(projectId, loggedUserId, isPublicFor)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'lock'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Default Privacy of new skills')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <SkillsDefaultPrivacyWrapper projectId={projectId} savePrivacy={savePrivacy} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
})
