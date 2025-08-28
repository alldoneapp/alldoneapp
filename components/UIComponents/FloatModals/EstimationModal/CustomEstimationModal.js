import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import CustomEstimationModalOption from './CustomEstimationModalOption'
import CustomEstimationModalEstimateButton from './CustomEstimationModalEstimateButton'
import ModalHeader from '../ModalHeader'

export default function CustomEstimationModal({ setEstimation, initialEstimation, closeModal }) {
    const [width, height] = useWindowSize()
    const [days, setDays] = useState(0)
    const [hours, setHours] = useState(0)
    const [minutes, setMinutes] = useState(0)

    useEffect(() => {
        if (initialEstimation) {
            let iDays = 0
            let iHours = 0
            let iMinutes = 0

            if (initialEstimation < 60) {
                iMinutes = initialEstimation
            } else {
                iHours = Math.floor(initialEstimation / 60)
                iMinutes = initialEstimation % 60
                if (iHours > 8) {
                    iDays = Math.floor(iHours / 8)
                    iHours = iHours % 8
                }
            }

            setDays(iDays)
            setHours(iHours)
            setMinutes(iMinutes)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <View style={localStyles.subContainer}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Custom estimation')}
                        description={translate('Enter the number of days, hours, and/or minutes for the estimation')}
                    />
                    <View style={{ flex: 1 }}>
                        <CustomEstimationModalOption
                            startFocus={true}
                            value={days}
                            setValue={setDays}
                            heading={'Days'}
                            placeholder={'days'}
                        />
                        <CustomEstimationModalOption
                            value={hours}
                            setValue={setHours}
                            heading={'Hours'}
                            placeholder={'hours'}
                        />
                        <CustomEstimationModalOption
                            value={minutes}
                            setValue={setMinutes}
                            heading={'Minutes'}
                            placeholder={'minutes'}
                        />
                    </View>
                </View>
                <CustomEstimationModalEstimateButton
                    days={days}
                    hours={hours}
                    minutes={minutes}
                    setEstimation={setEstimation}
                />
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    subContainer: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        marginBottom: 8,
    },
})
