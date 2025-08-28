import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import { getPopoverWidth } from '../../../utils/HelperFunctions'
import Button from '../../UIControls/Button'
import {
    getPersonalTrafficQuote,
    getProjectTrafficQuote,
    getPersonalXpQuote,
    getProjectXpQuote,
    PERSONAL_XP_QUOTE_LIMIT,
    PROJECT_QUOTA_TYPE,
    PROJECT_XP_QUOTE_LIMIT,
} from '../PremiumHelper'
import { setLimitQuotaModalData, navigateToSettings } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import ProgressBar from './ProgressBar'
import Line from '../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'

export default function LimitModal() {
    const dispatch = useDispatch()
    const quotaType = useSelector(state => state.limitQuotaModalData.quotaType)
    const monthlyXp = useSelector(state => state.limitQuotaModalData.monthlyXp)
    const monthlyTraffic = useSelector(state => state.limitQuotaModalData.monthlyTraffic)
    const projectName = useSelector(state => state.limitQuotaModalData.projectName)

    const closeModal = () => {
        dispatch(setLimitQuotaModalData(false, null, '', null, 0, 0))
    }

    const navigateToPremium = () => {
        NavigationService.navigate('SettingsView')
        dispatch([
            navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }),
            setLimitQuotaModalData(false, null, '', null, 0, 0),
        ])
    }

    const projectLimitReched = quotaType === PROJECT_QUOTA_TYPE

    const xpQuotaPercent = projectLimitReched ? getProjectXpQuote(monthlyXp) : getPersonalXpQuote(monthlyXp)
    const xpTrafficPercent = projectLimitReched
        ? getProjectTrafficQuote(monthlyTraffic)
        : getPersonalTrafficQuote(monthlyTraffic)

    const xpQuotaLimit = projectLimitReched ? PROJECT_XP_QUOTE_LIMIT : PERSONAL_XP_QUOTE_LIMIT

    const header = projectLimitReched
        ? translate('project monthly limit reached', { projectName })
        : translate('Monthly limit reached')
    const footer = projectLimitReched
        ? translate('Please just wait until next month or upgrade the project to Premium')
        : translate('Please just wait until next month or upgrade to Premium')

    const daysUntilNextMonth = moment().tz('Europe/Berlin').endOf('month').fromNow().split('in')[1].trimLeft()

    return (
        <View style={localStyles.parent}>
            <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
                <ModalHeader
                    closeModal={closeModal}
                    title={header}
                    description={translate('XP and or Traffic quota reached')}
                />

                <View style={localStyles.warning}>
                    <Icon name={'info'} size={16} color={colors.UtilityYellow150} style={{ marginRight: 8 }} />
                    <Text style={localStyles.warningText}>
                        {daysUntilNextMonth} {translate('until the next month begins')}
                    </Text>
                </View>

                <ProgressBar
                    percent={xpQuotaPercent}
                    headerText={translate('App usage in current month from XP quote', { xpQuotaLimit })}
                    headerTextStyle={{ color: '#fff' }}
                />

                <ProgressBar
                    percent={xpTrafficPercent}
                    headerText={translate('Traffic quota this month')}
                    containerStyle={{ marginTop: 24 }}
                    headerTextStyle={{ color: '#fff' }}
                />

                <Text style={[styles.body1, { color: colors.Grey400, marginTop: 32 }]}>{footer}</Text>

                <Line style={localStyles.line} />

                <Button
                    title={translate('Upgrade to Premium')}
                    icon={'crown'}
                    iconSize={22}
                    buttonStyle={localStyles.button}
                    onPress={navigateToPremium}
                />
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
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        padding: 16,
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
    },
    warningText: {
        ...styles.body2,
        color: colors.UtilityYellow150,
    },
    line: {
        marginVertical: 8,
    },
    button: {
        alignSelf: 'center',
        marginTop: 20,
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'center',
        color: colors.UtilityYellow150,
        marginBottom: 20,
    },
})
