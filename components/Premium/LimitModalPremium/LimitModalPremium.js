import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import { getPopoverWidth } from '../../../utils/HelperFunctions'
import Button from '../../UIControls/Button'
import { getPremiumTrafficQuote, getPersonalXpQuote, PERSONAL_XP_QUOTE_LIMIT } from '../PremiumHelper'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import ProgressPremiumBar from './ProgressPremiumBar'
import Line from '../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'
import { setShowLimitPremiumQuotaModal } from '../../../redux/actions'

export default function LimitModalPremium() {
    const dispatch = useDispatch()
    const monthlyXp = useSelector(state => state.loggedUser.monthlyXp)
    const monthlyTraffic = useSelector(state => state.loggedUser.monthlyTraffic)

    const closeModal = () => {
        dispatch(setShowLimitPremiumQuotaModal(false))
    }

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Monthly traffic limit reached')}
                    description={translate('Traffic limit reached')}
                />

                <View style={localStyles.warning}>
                    <Icon name={'info'} size={16} color={colors.UtilityYellow150} style={{ marginRight: 8 }} />
                    <Text style={localStyles.warningText}>
                        {moment().tz('Europe/Berlin').endOf('month').fromNow().split('in')[1].trimLeft()}{' '}
                        {translate('until the next month begins')}
                    </Text>
                </View>

                <ProgressPremiumBar
                    containerStyle={{ marginTop: 20 }}
                    headerText={translate('XP gained compared with limit in freemium')}
                    percent={getPersonalXpQuote(monthlyXp)}
                    barInnerText={`${monthlyXp}XP/${PERSONAL_XP_QUOTE_LIMIT}XP`}
                />

                <ProgressPremiumBar
                    containerStyle={{ marginTop: 24 }}
                    headerText={translate('Traffic quota this month')}
                    percent={getPremiumTrafficQuote(monthlyTraffic)}
                    barInnerText={`${getPremiumTrafficQuote(monthlyTraffic)}%`}
                />

                <Text style={localStyles.text}>
                    {translate('Please just wait until next month to refill the quota')}
                </Text>

                <Line style={localStyles.line} />

                <Button title={'OK'} iconSize={22} buttonStyle={localStyles.button} onPress={closeModal} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        top: '50%',
        left: '58.5%',
        transform: [{ translateX: '-60%' }, { translateY: '-50%' }],
        position: 'fixed',
        width: 432,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        padding: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    warningText: {
        ...styles.body2,
        color: colors.UtilityYellow150,
    },
    text: {
        ...styles.body1,
        color: colors.Grey400,
        marginTop: 32,
    },
    line: {
        marginTop: 8,
        marginBottom: 16,
    },
    button: {
        alignSelf: 'center',
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'center',
        color: colors.UtilityYellow150,
    },
})
