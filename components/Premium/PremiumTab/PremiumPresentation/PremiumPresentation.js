import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import PremiumSvg from '../../../../assets/svg/PremiumSvg'
import global, { colors } from '../../../styles/global'
import CreateCompanyWrapper from './CreateCompanyWrapper'
import { translate } from '../../../../i18n/TranslationService'
import PremiumFeatures from './PremiumFeatures'
import { PLAN_STATUS_FREE } from '../../PremiumHelper'
import Icon from '../../../Icon'

export default function PremiumPresentation({
    openCompanyPreview,
    selectedUserIds,
    setSelectedUsersIds,
    companyData,
    setCompanyData,
}) {
    const loggedUserPremiumStatus = useSelector(state => state.loggedUser.premium.status)

    return (
        <View style={localStyles.box}>
            <View style={localStyles.title}>
                {loggedUserPremiumStatus === PLAN_STATUS_FREE ? (
                    <PremiumSvg height={34} width={34} style={{ marginRight: 8 }} />
                ) : (
                    <Icon name="crown" size={28} color={colors.Text03} style={{ marginRight: 4 }} />
                )}
                <Text style={global.title6}>
                    {translate(
                        loggedUserPremiumStatus === PLAN_STATUS_FREE
                            ? 'Upgrade to Premium'
                            : 'Upgrade other users to Premium'
                    )}
                </Text>
            </View>
            <Text style={[global.body2, { marginTop: 16 }]}>
                {translate(
                    loggedUserPremiumStatus === PLAN_STATUS_FREE
                        ? 'Create a company with premium users description'
                        : 'Upgrade other users to premium subscription'
                )}
            </Text>
            <Text style={[global.body2, { marginTop: 22 }]}>{translate('Premium includes')}</Text>
            <View style={localStyles.block}>
                <PremiumFeatures />
                <CreateCompanyWrapper
                    openCompanyPreview={openCompanyPreview}
                    selectedUserIds={selectedUserIds}
                    setSelectedUsersIds={setSelectedUsersIds}
                    companyData={companyData}
                    setCompanyData={setCompanyData}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    box: {
        paddingTop: 16,
        paddingHorizontal: 16,
        overflow: 'hidden',
    },
    title: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    block: {
        marginTop: 16,
    },
})
