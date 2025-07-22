import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { useDispatch, useSelector } from 'react-redux'
import { setBacklinkSection } from '../../redux/actions'
import { translate } from '../../i18n/TranslationService'

const BacklinksHeader = ({ amountObj }) => {
    const backlinkSection = useSelector(state => state.backlinkSection)
    const dispatch = useDispatch()

    return (
        <View style={localStyles.container}>
            <View style={localStyles.info}>
                <View>
                    <Text style={[styles.title6, { color: colors.Text01, marginRight: 16 }]}>
                        {translate('Backlinks')}
                    </Text>
                </View>
            </View>
            <View>
                <MultiToggleSwitch
                    options={[
                        {
                            icon: 'file-text',
                            text: 'Notes',
                            badge: amountObj.notes,
                        },
                        {
                            icon: 'square',
                            text: 'Tasks',
                            badge: amountObj.tasks,
                        },
                    ]}
                    currentIndex={backlinkSection.index}
                    onChangeOption={(index, optionText) => {
                        dispatch(setBacklinkSection({ index: index, section: optionText }))
                    }}
                />
            </View>
        </View>
    )
}
export default BacklinksHeader

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxHeight: 72,
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
