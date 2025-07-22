import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import SelectProjectModalInGuideProjectsProperty from './SelectProjectModalInGuideProjectsProperty'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'

export default function GuidesProperty({ project }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <View style={localStyles.propertyRow}>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                <Icon name={'circle'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Community project')}</Text>
            </View>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                <Popover
                    content={
                        <SelectProjectModalInGuideProjectsProperty closeModal={closeModal} projectId={project.id} />
                    }
                    align={'start'}
                    position={['bottom']}
                    onClickOutside={closeModal}
                    isOpen={isOpen}
                    contentLocation={smallScreenNavigation ? null : undefined}
                >
                    <Button
                        icon={'map-pin'}
                        type={'ghost'}
                        title={translate('Communities')}
                        buttonStyle={{ maxWidth: 240 }}
                        onPress={openModal}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    propertyRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    propertyRowRight: {
        justifyContent: 'flex-end',
    },
})
