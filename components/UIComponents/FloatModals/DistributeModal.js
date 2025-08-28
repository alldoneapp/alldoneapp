import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import styles, { colors } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'
import Hotkeys from 'react-hot-keys'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Button from '../../UIControls/Button'
import moment from 'moment'
import Backend from '../../../utils/BackendBridge'
import { useDispatch, useSelector } from 'react-redux'
import { setSelectedTasks } from '../../../redux/actions'
import CustomScrollView from '../../UIControls/CustomScrollView'
import useWindowSize from '../../../utils/useWindowSize'

const items = [
    { key: 'One per Day', value: '1', shortcut: 'Alt + 1' },
    { key: 'Three per day', value: '3', shortcut: 'Alt + 2' },
    { key: 'Five per day', value: '5', shortcut: 'Alt + 3' },
]

const DistributeModal = ({ closePopover, tasks, setIsLoading }) => {
    const [width, height] = useWindowSize()
    const dispatch = useDispatch()
    const [tasksNumber, setTasksNumber] = useState('')
    const userId = useSelector(state => state.loggedUser.uid)

    const validateInteger = string => {
        if (Number.isInteger(Number(string))) {
            return string.replace(/^0+/, '').replace('.', '').trim()
        } else {
            return tasksNumber
        }
    }

    const render = (item, i) => {
        return (
            <View key={i}>
                <Hotkeys
                    key={i}
                    keyName={item.shortcut}
                    onKeyDown={() => handleDistribute(item.value)}
                    filter={e => true}
                >
                    <TouchableOpacity style={localStyles.item} onPress={() => handleDistribute(item.value)}>
                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{item.key}</Text>
                        <View style={{ marginLeft: 'auto' }}>
                            <Shortcut text={item.shortcut} theme={SHORTCUT_LIGHT} />
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    function compare(a, b) {
        if (a.sortIndex > b.sortIndex) return -1
        if (a.sortIndex < b.sortIndex) return 1
        return 0
    }

    const handleDistribute = tasksNumber => {
        setIsLoading(true)
        let date = moment()
        for (let i = 0; i < Math.ceil(tasks.length / tasksNumber); i++) {
            date.add(1, 'day')
            tasks
                .sort(compare)
                .slice(i * tasksNumber, (i + 1) * tasksNumber)
                .map(item => (item.newDueDate = date.valueOf()))
        }
        Backend.setTaskDueDateMultiple(tasks).then(() => setIsLoading(false))
        dispatch(setSelectedTasks(null, true))
        closePopover()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <View style={localStyles.title}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>Distribute task to future days</Text>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>
                        This group of task will be distribute in base to this number to future days.
                    </Text>
                </View>

                <View style={localStyles.estimationSection}>{items.map(render)}</View>

                <View style={localStyles.sectionSeparator} />

                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>Custom amount per day</Text>
                    <TextInput
                        style={[styles.body1, localStyles.commentBox]}
                        placeholder="Type a number"
                        placeholderTextColor={colors.Text03}
                        value={tasksNumber}
                        onChangeText={text => setTasksNumber(validateInteger(text))}
                    />
                </View>

                <View style={localStyles.button}>
                    <Button title={'Distribute'} onPress={() => handleDistribute(tasksNumber)} />
                </View>

                <CloseButton
                    style={{ top: -4 }}
                    close={e => {
                        if (e) {
                            e.preventDefault()
                            e.stopPropagation()
                        }
                        closePopover()
                    }}
                />
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    title: {
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    estimationSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingHorizontal: 16,
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 16,
    },
    shortcut: {
        position: 'absolute',
        right: 0,
    },
    commentBox: {
        color: 'white',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginTop: 4,
    },
    button: {
        alignSelf: 'center',
        paddingVertical: 16,
    },
    item: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        paddingVertical: 8,
        marginBottom: 4,
    },
})

export default DistributeModal
