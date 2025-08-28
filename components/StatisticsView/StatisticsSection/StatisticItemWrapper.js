import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { TouchableOpacity } from 'react-native'
import StatisticsByProjectAndEstimationType from '../../UIComponents/FloatModals/StatisticsByProjectAndEstimationType/StatisticsByProjectAndEstimationType'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'

export default function StatisticItemWrapper({ children, title, subtitle, estimationType, statistics }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setTimeout(() => {
            setVisiblePopover(false)
            dispatch(hideFloatPopup())
        })
    }

    return (
        <Popover
            content={
                <StatisticsByProjectAndEstimationType
                    title={title}
                    subtitle={subtitle}
                    estimationType={estimationType}
                    statistics={statistics}
                    hidePopover={hidePopover}
                />
            }
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity onPress={showPopover} accessible={false}>
                {children}
            </TouchableOpacity>
        </Popover>
    )
}
