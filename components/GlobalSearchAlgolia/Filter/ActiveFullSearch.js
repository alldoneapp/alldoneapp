import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../styles/global'
import CheckBox from '../../CheckBox'
import { translate } from '../../../i18n/TranslationService'
import { PLAN_STATUS_PREMIUM } from '../../Premium/PremiumHelper'
import { setShowLimitedFeatureModal } from '../../../redux/actions'
import RunOutOfGoldAssistantModal from '../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import moment from 'moment'

export default function ActiveFullSearch({
    disabled,
    activeFullSearchInAllProjects,
    activateFullSearch,
    closeModalSearchModal,
}) {
    const dispatch = useDispatch()
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const activeFullSearchDate = useSelector(state => state.loggedUser.activeFullSearchDate)
    const gold = useSelector(state => state.loggedUser.gold)
    const [isOpen, setIsOpen] = useState(false)

    const showPremiumModal = () => {
        closeModalSearchModal()
        dispatch(setShowLimitedFeatureModal(true))
    }

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const getFullSearchDaysLeft = () => {
        if (activeFullSearchDate) {
            const leftDays = moment(activeFullSearchDate).diff(moment().subtract(14, 'days'), 'days') + 1
            return leftDays > 0 ? leftDays : 1
        }
        return 0
    }

    return (
        <Popover
            content={
                <RunOutOfGoldAssistantModal
                    closeModal={closeModal}
                    closeModalWhenNavigateToPremium={closeModalSearchModal}
                />
            }
            align={'start'}
            position={['right']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity
                disabled={disabled || activeFullSearchInAllProjects}
                onPress={
                    premiumStatus === PLAN_STATUS_PREMIUM
                        ? gold >= 500
                            ? activateFullSearch
                            : openModal
                        : showPremiumModal
                }
                style={localStyles.container}
            >
                <CheckBox
                    externalContainerStyle={
                        activeFullSearchInAllProjects ? { borderWidth: 1 } : { backgroundColor: 'transparent' }
                    }
                    checked={activeFullSearchInAllProjects}
                />
                <Text style={localStyles.text}>
                    {activeFullSearchDate
                        ? translate('Active full search for x days', { days: getFullSearchDaysLeft() })
                        : translate('Activate full search for 14 days for 500 Gold')}
                </Text>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        paddingHorizontal: 16,
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginBottom: 16,
        paddingVertical: 8,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
