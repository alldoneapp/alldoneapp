import { runWithLoading } from '../../utils/redux/loadingOperation'
import React, { useEffect } from 'react'

import { updateInvoiceFromData } from '../../utils/backends/firestore'
import Button from '../UIControls/Button'
import { TO_STEP } from './InvoiceInfoModal'

export default function ContinueButton({ projectId, scrollRef, setStep, fromData, setFromData }) {
    const moveToNextStep = async () => {
        return runWithLoading(
            'invoice_next_step',
            async () => {
                await updateInvoiceFromData(projectId, fromData, setFromData)

                setStep(TO_STEP)
                scrollRef.current.scrollTo({ y: 0, animated: false })
            },
            { enabled: !!(fromData.logoUpdated && fromData.logo) }
        )
    }

    const onKeyDown = e => {
        if (e.key === 'Enter') moveToNextStep()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return <Button title={'Continue'} buttonStyle={{ alignSelf: 'center' }} onPress={moveToNextStep} />
}
