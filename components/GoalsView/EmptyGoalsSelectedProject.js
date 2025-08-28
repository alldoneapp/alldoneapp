import React from 'react'
import { Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import ModernImage from '../../utils/ModernImage'
import { translate } from '../../i18n/TranslationService'

export default function EmptyGoalsSelectedProject() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={localStyles.emptyInbox}>
            <ModernImage
                srcWebp={require('../../web/images/illustrations/Empty-Goals-All-Projects.webp')}
                fallback={require('../../web/images/illustrations/Empty-Goals-All-Projects.png')}
                style={{ flex: 1, width: '100%', maxWidth: 500 }}
                alt={'Empty Goals inbox All projects'}
            />
            <View style={[localStyles.emptyInboxText, smallScreenNavigation && localStyles.emptyInboxTextMobile]}>
                <Icon name={'info'} size={22} color={colors.Text03} style={{ marginRight: 9 }} />
                <Text style={[styles.body1, { color: colors.Text02, textAlign: 'center' }]}>
                    {translate('You can add goals to define a roadmap & milestones together with your project')}
                </Text>
            </View>
        </View>
    )
}

const localStyles = {
    emptyInbox: {
        flex: 1,
        marginTop: 32,
        alignItems: 'center',
    },
    emptyInboxText: {
        marginTop: 32,
        maxWidth: 700,
        marginHorizontal: 104,
        alignItems: 'flex-start',
        flexDirection: 'row',
    },
    emptyInboxTextMobile: {
        marginHorizontal: 16,
    },
}
