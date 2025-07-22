import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'
import { isEqual } from 'lodash'

import { colors } from '../../../styles/global'
import { PAYMENT_METHOD_CREDIT_CARD, PLAN_STATUS_FREE, removeUsersPaidByOtherUser } from '../../PremiumHelper'
import PremiumPresentation from '../PremiumPresentation/PremiumPresentation'
import CompanyPreview from '../CompanyPreview/CompanyPreview'
import PaymentMethods from '../PaymentMethods/PaymentMethods'

const DEFAULT_COMPANY_DATA = {
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postalCode: '',
    country: '',
}

const PREMIUM_PRESENTATION = 0
const COMPANY_PREVIEW = 1
const PAYMENT_METHODS = 2

export default function CreatePremiumSubscription() {
    const projectUsers = useSelector(state => state.projectUsers)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserPremiumStatus = useSelector(state => state.loggedUser.premium.status)
    const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHOD_CREDIT_CARD)
    const [upgradeToPremiumStep, setUpgradeToPremiumStep] = useState(PREMIUM_PRESENTATION)
    const [selectedUserIds, setSelectedUsersIds] = useState(
        loggedUserPremiumStatus === PLAN_STATUS_FREE ? [loggedUserId] : []
    )
    const [companyData, setCompanyData] = useState(DEFAULT_COMPANY_DATA)

    const checkForUsersPaidByOtherUser = async () => {
        const newSelectedUserIds = await removeUsersPaidByOtherUser(selectedUserIds)
        if (!isEqual(newSelectedUserIds, selectedUserIds)) setSelectedUsersIds(newSelectedUserIds)
    }

    useEffect(() => {
        checkForUsersPaidByOtherUser()
    }, [projectUsers, selectedUserIds])

    const openPremiumPresentation = () => {
        setUpgradeToPremiumStep(PREMIUM_PRESENTATION)
    }

    const openCompanyPreview = () => {
        setUpgradeToPremiumStep(COMPANY_PREVIEW)
    }

    const openPaymenthMethods = () => {
        setUpgradeToPremiumStep(PAYMENT_METHODS)
    }

    const resetData = () => {
        openPremiumPresentation()
        setSelectedUsersIds(loggedUserPremiumStatus === PLAN_STATUS_FREE ? [loggedUserId] : [])
        setCompanyData(DEFAULT_COMPANY_DATA)
    }

    const inPresentationStep = upgradeToPremiumStep === PREMIUM_PRESENTATION
    const inCompanyPreviewStep = upgradeToPremiumStep === COMPANY_PREVIEW
    const inPaymenthMethodsStep = upgradeToPremiumStep === PAYMENT_METHODS

    return (
        <View style={localStyles.container}>
            {inPresentationStep && (
                <PremiumPresentation
                    openCompanyPreview={openCompanyPreview}
                    selectedUserIds={selectedUserIds}
                    setSelectedUsersIds={setSelectedUsersIds}
                    companyData={companyData}
                    setCompanyData={setCompanyData}
                />
            )}
            {(inCompanyPreviewStep || inPaymenthMethodsStep) && (
                <CompanyPreview
                    companyData={companyData}
                    setCompanyData={setCompanyData}
                    selectedUserIds={selectedUserIds}
                    setSelectedUsersIds={setSelectedUsersIds}
                    openPaymenthMethods={openPaymenthMethods}
                    inCompanyPreviewStep={inCompanyPreviewStep}
                    resetData={resetData}
                />
            )}
            {inPaymenthMethodsStep && (
                <PaymentMethods
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                    openCompanyPreview={openCompanyPreview}
                    selectedUserIds={selectedUserIds}
                    companyData={companyData}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Gray200,
        borderRadius: 4,
        paddingBottom: 16,
        marginBottom: 22,
    },
})
