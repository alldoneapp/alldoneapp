import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import HourlyRateAndCurrencyModal from './HourlyRateAndCurrencyModal'
import HourlyRateAndCurrencyButton from './HourlyRateAndCurrencyButton'

export default function HourlyRateAndCurrencyWrapper({ hourlyRatesData, projectId }) {
    const [isOpen, setIsOpen] = useState(false)

    const closeModal = () => {
        setIsOpen(false)
    }

    const openModal = () => {
        setIsOpen(true)
    }

    return (
        <Popover
            content={
                <HourlyRateAndCurrencyModal
                    projectId={projectId}
                    closeModal={closeModal}
                    hourlyRatesData={hourlyRatesData}
                />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['left', 'right', 'top', 'bottom']}
            padding={4}
            align={'end'}
        >
            <HourlyRateAndCurrencyButton currency={hourlyRatesData.currency} openModal={openModal} />
        </Popover>
    )
}
