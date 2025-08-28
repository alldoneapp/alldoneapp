import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import DateItem from './DateItem'
import CloseButton from './CloseButton'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../utils/HelperFunctions'
import { FOLLOW_UP_DUE_DATE_MODAL_ID, removeModal, storeModal } from '../ModalsManager/modalsManager'
import CustomScrollView from '../UIControls/CustomScrollView'
import useWindowSize from '../../utils/useWindowSize'
import { translate } from '../../i18n/TranslationService'

export default function FollowUpDueDate({
    closePopover,
    selectDate,
    selectBacklog,
    onCustomDatePress,
    dateText,
    directFollowUp = false,
}) {
    const [width, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)

    const TODAY = 'Today'
    const TOMORROW = 'Tomorrow'
    const THIS_NEXT_SATURDAY = 'This next Saturday'
    const THIS_NEXT_MONDAY = 'This next Monday'
    const IN_2_DAYS = 'In 2 days'
    const IN_4_DAYS = 'In 4 days'
    const IN_7_DAYS = 'In 7 days'
    const IN_30_DAYS = 'In 30 days'
    const BACKLOG = 'Someday'
    const LAST_SELECTED = 'Last selected'

    const closePopup = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        closePopover()
    }

    useEffect(() => {
        storeModal(FOLLOW_UP_DUE_DATE_MODAL_ID)
        return () => {
            removeModal(FOLLOW_UP_DUE_DATE_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={localStyles.heading}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white', paddingRight: 16, flex: 1 }]}>
                            {translate(directFollowUp ? 'Select Follow-up task reminder' : 'Select Follow up reminder')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03, flex: 1 }]}>
                            {translate(
                                directFollowUp ? 'Select the date for the Follow-up' : 'Select from the options below'
                            )}
                        </Text>
                    </View>
                </View>
                <View style={localStyles.itemsContainer}>
                    <DateItem onPress={selectDate} selected={dateText === TODAY}>
                        {TODAY}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === TOMORROW}>
                        {TOMORROW}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === THIS_NEXT_SATURDAY}>
                        {THIS_NEXT_SATURDAY}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === THIS_NEXT_MONDAY}>
                        {THIS_NEXT_MONDAY}
                    </DateItem>
                </View>
                <View style={localStyles.daysContainer}>
                    <DateItem onPress={selectDate} selected={dateText === IN_2_DAYS}>
                        {IN_2_DAYS}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === IN_4_DAYS}>
                        {IN_4_DAYS}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === IN_7_DAYS}>
                        {IN_7_DAYS}
                    </DateItem>
                    <DateItem onPress={selectDate} selected={dateText === IN_30_DAYS}>
                        {IN_30_DAYS}
                    </DateItem>
                </View>

                <View style={localStyles.backlogContainer}>
                    <DateItem onPress={selectBacklog}>{BACKLOG}</DateItem>
                </View>

                <View style={localStyles.pickDateContainer}>
                    <DateItem onPress={selectDate}>{LAST_SELECTED}</DateItem>
                    <DateItem onPress={onCustomDatePress}>Custom date</DateItem>
                </View>
                {!directFollowUp && (
                    <Hotkeys keyName={'B'} onKeyDown={(s, e) => closePopup(e)} filter={e => true}>
                        <TouchableOpacity style={localStyles.backContainer} onPress={closePopup}>
                            <Icon name="chevron-left" size={24} color={colors.Text03} />
                            <Text style={[styles.subtitle1, localStyles.backText]}>{translate('Back')}</Text>

                            {!mobile && (
                                <View style={localStyles.shortcut}>
                                    <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                                </View>
                            )}
                        </TouchableOpacity>
                    </Hotkeys>
                )}
                <CloseButton close={closePopup} />
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 305,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    heading: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flex: 1,
        flexDirection: 'column',
        marginTop: 8,
    },
    itemsContainer: {
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 16,
    },
    daysContainer: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    pickDateContainer: {
        paddingVertical: 8,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        paddingHorizontal: 16,
    },
    backlogContainer: {
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    backContainer: {
        flexDirection: 'row',
        paddingVertical: 16,
        paddingLeft: 16,
    },
    backText: {
        color: '#FFFFFF',
        fontWeight: '500',
        marginLeft: 8,
    },
    shortcut: {
        position: 'absolute',
        marginTop: 4,
        right: 16,
    },
})
