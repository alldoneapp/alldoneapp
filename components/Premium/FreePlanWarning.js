import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { navigateToSettings } from '../../redux/actions'
import NavigationService from '../../utils/NavigationService'
import { DV_TAB_SETTINGS_PREMIUM } from '../../utils/TabNavigationConstants'
import { useDispatch, useSelector } from 'react-redux'
import { getPopoverWidth } from '../../utils/HelperFunctions'
import {
    getPersonalTrafficQuote,
    getProjectTrafficQuote,
    getPersonalXpQuote,
    getProjectXpQuote,
    PERSONAL_XP_QUOTE_LIMIT,
    PLAN_STATUS_PREMIUM,
    PROJECT_XP_QUOTE_LIMIT,
} from './PremiumHelper'
import Button from '../UIControls/Button'
import CloseButton from '../FollowUp/CloseButton'
import { translate } from '../../i18n/TranslationService'
import ProgressBar from './LimitModal/ProgressBar'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { removeQuotaWarnings } from '../../utils/backends/Premium/premiumFirestore'

export default function FreePlanWarning() {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const monthlyXp = useSelector(state => state.loggedUser.monthlyXp)
    const monthlyTraffic = useSelector(state => state.loggedUser.monthlyTraffic)
    const quotaWarnings = useSelector(state => state.loggedUser.quotaWarnings)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)

    const [warnings, setWarnings] = useState({})

    useEffect(() => {
        if (premiumStatus === PLAN_STATUS_PREMIUM) {
            setWarnings({})
        } else {
            setWarnings(warnings => {
                return { ...warnings, ...quotaWarnings }
            })
        }
        if (Object.keys(quotaWarnings).length > 0) removeQuotaWarnings(loggedUserId)
    }, [quotaWarnings, premiumStatus])

    const resetNotification = warningId => {
        const newWarnings = { ...warnings }
        delete newWarnings[warningId]
        setWarnings(newWarnings)
    }

    const getHeaderText = (warningId, percent) => {
        if (warningId === loggedUserId) {
            return translate('percent of free plan reached', { percent })
        } else {
            const project = ProjectHelper.getProjectById(warningId)
            return project
                ? translate('percent of project free plan reached', { percent, projectName: project.name })
                : ''
        }
    }

    const getFooterText = warningId => {
        const text =
            warningId === loggedUserId
                ? 'Upgrade to Premium and forget about limits'
                : 'Upgrade the project to Premium and forget about limits'
        return translate(text)
    }

    const getCurrentPercents = warningId => {
        if (warningId === loggedUserId) {
            return {
                xpQuotaPercent: getPersonalXpQuote(monthlyXp),
                xpTrafficPercent: getPersonalTrafficQuote(monthlyTraffic),
            }
        } else {
            const project = ProjectHelper.getProjectById(warningId)
            return {
                xpQuotaPercent: getProjectXpQuote(project ? project.monthlyXp : 0),
                xpTrafficPercent: getProjectTrafficQuote(project ? project.monthlyTraffic : 0),
            }
        }
    }

    const warningsArray = Object.entries(warnings)
    const warning = warningsArray[0]

    if (premiumStatus === PLAN_STATUS_PREMIUM || !warning) return null
    const warningId = warning[0]
    const decimalPercent = warning[1]

    const xpQuotaLimit = warningId !== loggedUserId ? PROJECT_XP_QUOTE_LIMIT : PERSONAL_XP_QUOTE_LIMIT

    const percent = decimalPercent * 100
    const headerText = getHeaderText(warningId, percent)
    const footerText = getFooterText(warningId)
    const { xpQuotaPercent, xpTrafficPercent } = getCurrentPercents(warningId)

    const daysUntilNextMonth = moment().tz('Europe/Berlin').endOf('month').fromNow().split('in')[1].trimLeft()

    return (
        <>
            {headerText ? (
                <View style={localStyles.parent}>
                    <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
                        <View style={{ paddingHorizontal: 16 }}>
                            <Text style={[styles.title7, { color: 'white', marginRight: 24 }]}>{headerText}</Text>
                            <Text style={localStyles.subtitle}>
                                {translate('XP and or Traffic quota percent reached', { percent })}
                            </Text>

                            <View style={localStyles.warning}>
                                <Icon
                                    name={'info'}
                                    size={16}
                                    color={colors.UtilityYellow150}
                                    style={{ marginRight: 8 }}
                                />
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

                            <Text style={[styles.body1, { color: colors.Grey400, marginTop: 32 }]}>{footerText}</Text>
                        </View>

                        <View style={localStyles.line} />

                        <View style={localStyles.button}>
                            <Button
                                title={translate('Upgrade to Premium')}
                                icon={'crown'}
                                iconSize={22}
                                buttonStyle={{ alignSelf: 'center' }}
                                onPress={() => {
                                    NavigationService.navigate('SettingsView')
                                    dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
                                    resetNotification(warningId)
                                }}
                            />
                        </View>
                        <CloseButton
                            close={() => {
                                resetNotification(warningId)
                            }}
                        />
                    </View>
                </View>
            ) : null}
        </>
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
        paddingVertical: 16,
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
        borderWidth: 1,
        borderBottomColor: '#fff',
        marginTop: 8,
        marginBottom: 8,
        opacity: 0.2,
    },
    button: {
        paddingHorizontal: 16,
        marginTop: 8,
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'center',
        color: colors.UtilityYellow150,
        marginVertical: 20,
    },
})
