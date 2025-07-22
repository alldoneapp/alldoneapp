import React, { useState, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../utils/HelperFunctions'
import CustomScrollView from '../UIControls/CustomScrollView'
import { colors } from '../styles/global'
import useWindowSize from '../../utils/useWindowSize'
import GenerateInvoice from './GenerateInvoice'
import ModalHeader from '../UIComponents/FloatModals/ModalHeader'
import CompanyData from '../Premium/PremiumTab/CompanyInfoModal/CompanyData'
import Line from '../UIComponents/FloatModals/GoalMilestoneModal/Line'
import { translate } from '../../i18n/TranslationService'
import ContinueButton from './ContinueButton'
import { useSelector } from 'react-redux'
import CompanyDataExtended from '../Premium/PremiumTab/CompanyInfoModal/CompanyDataExtended'

const FROM_STEP = 0
export const TO_STEP = 1

export default function InvoiceInfoModal({
    filterData,
    projectId,
    setShowGenerate,
    timestamp1,
    timestamp2,
    hidePopover,
    initialFromData,
    initialToData,
}) {
    const language = useSelector(state => state.loggedUser.language)
    const [step, setStep] = useState(FROM_STEP)
    const [fromData, setFromData] = useState(
        initialFromData
            ? { ...initialFromData, vat: initialFromData.vat ? initialFromData.vat : 0 }
            : {
                  name: '',
                  addressLine1: '',
                  addressLine2: '',
                  city: '',
                  postalCode: '',
                  country: '',
                  companyRegister: '',
                  vat: 19,
                  logo: '',
                  logoUpdated: false,
                  taxNumber: '',
                  vatId: '',
                  ceo: '',
                  bank: '',
                  bankAddress: '',
                  iban: '',
                  bic: '',
              }
    )
    const [toData, setToData] = useState(
        initialToData
            ? initialToData
            : {
                  name: '',
                  addressLine1: '',
                  addressLine2: '',
                  city: '',
                  postalCode: '',
                  country: '',
                  companyRegister: '',
              }
    )
    const scrollRef = useRef(null)
    const [width, height] = useWindowSize()

    const title = translate(step === FROM_STEP ? 'Enter your own Invoice Information' : 'Who this invoice should go to')
    const description = translate(
        step === FROM_STEP
            ? 'Legal disclaimers info 1'
            : 'Please enter the address of who you want to send the invoice to'
    )
    const description2 = step === FROM_STEP ? translate('Legal disclaimers info 2') : undefined

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView ref={scrollRef} style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    title={title}
                    description={description}
                    description2={description2}
                    closeModal={hidePopover}
                />
                {step === FROM_STEP ? (
                    <CompanyDataExtended data={fromData} setData={setFromData} />
                ) : (
                    <CompanyData data={toData} setData={setToData} />
                )}
                <Line style={{ marginVertical: 16 }} />
                {step === FROM_STEP ? (
                    <ContinueButton
                        projectId={projectId}
                        scrollRef={scrollRef}
                        setStep={setStep}
                        fromData={fromData}
                        setFromData={setFromData}
                    />
                ) : (
                    <GenerateInvoice
                        fromData={fromData}
                        toData={toData}
                        timestampsNumeric={{
                            startDate: timestamp1.clone().locale(language).format('DD.MM.'),
                            endDate: timestamp2.clone().locale(language).format('DD.MM.'),
                        }}
                        timestamps={{
                            startDate: timestamp1
                                .clone()
                                .locale(language)
                                .format(language === 'en' ? 'D. MMM. YYYY' : 'D. MMM YYYY'),
                            endDate: timestamp2
                                .clone()
                                .locale(language)
                                .format(language === 'en' ? 'D. MMM. YYYY' : 'D. MMM YYYY'),
                        }}
                        filterData={filterData}
                        projectId={projectId}
                        setShowGenerate={setShowGenerate}
                    />
                )}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    buttonStyle: {
        marginTop: 16,
        alignSelf: 'flex-end',
    },
})
