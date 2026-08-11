import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { getPopoverWidth } from '../../../../utils/HelperFunctions'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import CompanyData from '../CompanyInfoModal/CompanyData'
import { updateCompanyDataInSubscription } from '../../../../utils/backends/Premium/premiumFirestore'
import Backend from '../../../../utils/BackendBridge'

export default function CompanyAddressModal({
    usePersistentSave,
    closeModal,
    companyData,
    setCompanyData,
    subscription,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [tmpCompanyData, setTmpCompanyData] = useState(companyData)

    const updateData = () => {
        closeModal()
        setTimeout(() => {
            setCompanyData(tmpCompanyData)
        })
        if (usePersistentSave) updateCompanyDataInSubscription(tmpCompanyData, subscription)
        Backend.logEvent('update_invoce_address', {
            userId: loggedUserId,
        })
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') updateData()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={[localStyles.container, { minWidth: getPopoverWidth(), maxWidth: getPopoverWidth() }]}>
            <View style={{ paddingHorizontal: 16 }}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Billing address')}
                    description={translate(
                        'This address is optional but will be included in the invoice sent via email'
                    )}
                />
                <CompanyData data={tmpCompanyData} setData={setTmpCompanyData} />
            </View>
            <View style={localStyles.line} />
            <Button title={translate('Save')} buttonStyle={{ alignSelf: 'center' }} onPress={updateData} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        borderRadius: 4,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    line: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 16,
        opacity: 0.2,
    },
})
