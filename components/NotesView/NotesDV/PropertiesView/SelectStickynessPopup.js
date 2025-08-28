import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import StickynessItem from './StickynessItem'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'

const SelectStickynessPopup = ({ hidePopover, projectId, note, saveStickyBeforeSaveNote, isChat }) => {
    const [width, height] = useWindowSize()
    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <View style={localStyles.innerContainer}>
                    <View style={localStyles.heading}>
                        <View style={localStyles.title}>
                            <Text style={[styles.title7, { color: 'white' }]}>{translate('Make sticky')}</Text>
                            <Text style={[styles.body2, { color: colors.Text03, width: 273 }]}>
                                {translate('Select how long the object will be sticky', {
                                    object: translate(isChat ? 'chat' : 'note'),
                                })}
                            </Text>
                        </View>
                    </View>
                    <View style={localStyles.contentContainer}>
                        <StickynessItem
                            days={0}
                            number={0}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                        <StickynessItem
                            days={1}
                            number={1}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                        <StickynessItem
                            days={3}
                            number={2}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                        <StickynessItem
                            days={7}
                            number={3}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                        <StickynessItem
                            days={30}
                            number={4}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                        <StickynessItem
                            days={99 * 365}
                            number={5}
                            note={note}
                            projectId={projectId}
                            hidePopover={hidePopover}
                            saveStickyBeforeSaveNote={saveStickyBeforeSaveNote}
                            isChat={isChat}
                        />
                    </View>

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeButton} onPress={hidePopover}>
                            <Icon name="x" size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </View>
            </CustomScrollView>
        </View>
    )
}
export default SelectStickynessPopup

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    contentContainer: {
        marginTop: 8,
        paddingRight: 8,
        paddingLeft: 16,
        paddingBottom: 8,
    },
    heading: {
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
