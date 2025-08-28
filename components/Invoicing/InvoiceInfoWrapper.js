import React, { useState, useEffect } from 'react'
import Popover from 'react-tiny-popover'
import { StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'
import InvoiceInfoModal from './InvoiceInfoModal'
import { watchInvoiceData } from '../../utils/backends/firestore'
import Backend from '../../utils/BackendBridge'

export default function InvoiceInfoWrapper({ filterData, projectId, timestamp1, timestamp2 }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const [isOpen, setIsOpen] = useState(false)
    const [invoiceData, setInvoiceData] = useState({})

    const showPopover = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const hidePopover = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        const watcherKey = v4()
        watchInvoiceData(projectId, watcherKey, setInvoiceData)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    return (
        <Popover
            content={
                <InvoiceInfoModal
                    filterData={filterData}
                    projectId={projectId}
                    setShowGenerate={setIsOpen}
                    timestamp1={timestamp1}
                    timestamp2={timestamp2}
                    hidePopover={hidePopover}
                    initialFromData={invoiceData.fromData}
                    initialToData={invoiceData.toData}
                />
            }
            onClickOutside={hidePopover}
            isOpen={isOpen}
            position={['right', 'top', 'left', 'bottom']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <Button
                icon="several-file-text"
                title={translate('Generate Invoice')}
                type={'ghost'}
                buttonStyle={localStyles.buttonStyle}
                onPress={showPopover}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        marginTop: 16,
        alignSelf: 'flex-end',
    },
})
