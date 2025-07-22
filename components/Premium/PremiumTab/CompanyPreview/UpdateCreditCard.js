import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import { updateCreditCardNumber } from '../../../../utils/backends/Premium/premiumFirestore'

export default function UpdateCreditCard() {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [processing, setProcessing] = useState(false)

    const updateCreditCard = () => {
        setProcessing(true)
        updateCreditCardNumber({ userPayingId: loggedUserId, urlOrigin: window.location.origin }).then(async param => {
            param && param.data && param.data.checkout
                ? window.open(param.data.checkout, '_self')
                : setProcessing(false)
        })
    }

    return (
        <Button
            processing={processing}
            processingTitle="Processing"
            type={'ghost'}
            title={translate('Update credit card')}
            icon={!processing && 'edit'}
            buttonStyle={{ marginTop: 8 }}
            onPress={updateCreditCard}
        />
    )
}
