import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { findIndex, sortBy } from 'lodash'
import WorkflowUserItem from './WorkflowUserItem'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../utils/HelperFunctions'
import CustomScrollView from '../UIControls/CustomScrollView'
import useWindowSize from '../../utils/useWindowSize'
import { translate } from '../../i18n/TranslationService'

export default function SelectUserModal({ projectIndex, closePopover }) {
    const [width, height] = useWindowSize()

    const project = useSelector(state => state.loggedUserProjects[projectIndex])
    const usersInProject = useSelector(state => state.projectUsers[project.id])
    const workflowStep = useSelector(state => state.workflowStep)
    const [hoverUserId, setHoverUserId] = useState(workflowStep.reviewerUid)

    const currProjectUsers = sortBy(usersInProject, [item => item.displayName.toLowerCase()])
    const viewRef = React.createRef()

    const getNextUserId = () => {
        const index = findIndex(currProjectUsers, ['uid', hoverUserId])
        if (index + 1 === currProjectUsers.length) {
            return currProjectUsers[0].uid
        } else {
            return currProjectUsers[index + 1].uid
        }
    }

    const onPressEnter = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }

        const index = findIndex(currProjectUsers, ['uid', hoverUserId])
        const step = {
            uid: currProjectUsers[index].uid,
            photoURL: currProjectUsers[index].photoURL,
            displayName: currProjectUsers[index].displayName,
        }
        closePopover(step)
    }

    const onKeyPress = (s, e, handler) => {
        switch (handler.key) {
            case 'up': {
                setHoverUserId(getPreviousUserId())
                break
            }
            case 'down': {
                setHoverUserId(getNextUserId())
                break
            }
            case 'enter': {
                onPressEnter(e)
                break
            }
        }
    }

    const getPreviousUserId = () => {
        const index = findIndex(currProjectUsers, ['uid', hoverUserId])
        if (index === 0) {
            return currProjectUsers[currProjectUsers.length - 1].uid
        } else {
            return currProjectUsers[index - 1].uid
        }
    }

    const closeButton = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        closePopover()
    }

    return (
        <View ref={viewRef} style={localStyles.container}>
            <View
                style={[localStyles.innerContainer, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <Hotkeys keyName={'up,down,enter'} onKeyDown={onKeyPress} filter={e => true}>
                        <View style={localStyles.heading}>
                            <View style={localStyles.title}>
                                <Text style={[styles.title7, { color: 'white' }]}>{translate('Choose a user')}</Text>
                                <Text style={[styles.body2, { color: colors.Text03 }]}>
                                    {translate('Select who will review the step')}
                                </Text>
                            </View>

                            <View style={localStyles.closeContainer}>
                                <Hotkeys keyName={'esc'} onKeyDown={(s, e) => closeButton(e)} filter={e => true}>
                                    <TouchableOpacity style={localStyles.closeSubContainer} onPress={closePopover}>
                                        <Icon name="x" size={24} color={colors.Text03} />
                                    </TouchableOpacity>
                                </Hotkeys>
                            </View>
                        </View>
                    </Hotkeys>

                    <View style={localStyles.userListContainer}>
                        {currProjectUsers.map((el, index) => {
                            return (
                                <WorkflowUserItem
                                    key={index}
                                    user={el}
                                    selected={el.uid === workflowStep.reviewerUid}
                                    projectId={project.id}
                                    closePopover={closePopover}
                                    active={el.uid === hoverUserId}
                                />
                            )
                        })}
                    </View>
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
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
    userListContainer: {
        flexDirection: 'column',
        marginTop: 20,
        paddingHorizontal: 8,
        paddingBottom: 8,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeContainer: {
        width: 40,
        height: 40,
        marginLeft: 'auto',
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    heading: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
})
