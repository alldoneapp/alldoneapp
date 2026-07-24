import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { getPopoverWidth } from '../../../../utils/HelperFunctions'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import CompanyData from './CompanyData'
import Backend from '../../../../utils/BackendBridge'

export default function CompanyInfoModal({ openCompanyPreview, closeModal, companyData, setCompanyData }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const saveInfo = () => {
        openCompanyPreview()
        Backend.logEvent('add_invoce_address', {
            userId: loggedUserId,
        })
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') saveInfo()
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
                    title={translate('Optional Billing info')}
                    description={translate('Billing info description')}
                />
                <CompanyData data={companyData} setData={setCompanyData} />
            </View>
            <View style={localStyles.line} />
            <Button title={translate('Save')} buttonStyle={{ alignSelf: 'center' }} onPress={saveInfo} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    line: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 16,
        opacity: 0.2,
    },
})
