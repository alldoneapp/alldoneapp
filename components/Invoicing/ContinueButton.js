import React, { useEffect } from 'react'
import { useDispatch } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
import { updateInvoiceFromData } from '../../utils/backends/firestore'
import Button from '../UIControls/Button'
import { TO_STEP } from './InvoiceInfoModal'

export default function ContinueButton({ projectId, scrollRef, setStep, fromData, setFromData }) {
    const dispatch = useDispatch()

    const moveToNextStep = async () => {
        const showSpinner = fromData.logoUpdated && fromData.logo
        if (showSpinner) dispatch(startLoadingData())
        await updateInvoiceFromData(projectId, fromData, setFromData)
        if (showSpinner) dispatch(stopLoadingData())
        setStep(TO_STEP)
        scrollRef.current.scrollTo({ y: 0, animated: false })
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
