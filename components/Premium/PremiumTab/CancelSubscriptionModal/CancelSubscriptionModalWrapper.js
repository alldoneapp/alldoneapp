import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import CancelSubscriptionModal from './CancelSubscriptionModal'
import { useSelector } from 'react-redux'

export default function CancelSubscriptionModalWrapper({ subscription }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const openModal = () => {
        setOpen(true)
    }

    const closeModal = () => {
        setOpen(false)
    }

    return (
        <Popover
            isOpen={open}
            onClickOutside={closeModal}
            position={['top', 'bottom', 'left', 'right']}
            padding={4}
            content={<CancelSubscriptionModal closeModal={closeModal} subscription={subscription} />}
        >
            <Button
                icon={'cap'}
                title={translate(smallScreenNavigation ? 'Downgrade' : 'Downgrade to Free')}
                type={'ghost'}
                iconColor={colors.UtilityRed200}
                titleStyle={{ color: colors.UtilityRed200 }}
                buttonStyle={{
                    borderColor: colors.UtilityRed200,
                    borderWidth: 2,
                    marginTop: 24,
                    alignSelf: 'center',
                }}
                accessible={false}
                onPress={openModal}
            />
        </Popover>
    )
}
