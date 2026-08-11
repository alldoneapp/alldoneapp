import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { MAX_USERS_TO_SHOW } from '../../Followers/FollowerConstants'
import { useSelector } from 'react-redux'
import Avatar from '../../Avatar'
import UsersPlusButton from '../../Followers/UsersPlusButton'
import FilterStatisticsModal from './FilterByUserModal'

const FilterByUser = ({ projectIndex, filterByUsers, projectId }) => {
    const [isOpen, setIsOpen] = useState(false)
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const usersToShow = usersInProject.filter(el => filterByUsers.some(f => f === el.uid))

    return (
        <View style={localStyles.propertyRow}>
            <View style={localStyles.title}>
                <Icon name={'filter'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Filter by users')}</Text>
            </View>
            <Popover
                content={
                    <FilterStatisticsModal
                        projectIndex={projectIndex}
                        projectId={projectId}
                        filterByUsers={filterByUsers}
                        setIsOpen={setIsOpen}
                    />
                }
                onClickOutside={() => setIsOpen(false)}
                isOpen={isOpen}
                position={['left', 'bottom', 'right', 'top']}
                padding={4}
                align={'end'}
            >
                <View style={{ justifyContent: 'flex-end' }}>
                    <View style={localStyles.container}>
                        {usersToShow.slice(0, MAX_USERS_TO_SHOW).map((user, index) => (
                            <View
                                key={user.uid}
                                style={usersToShow.length > 1 && index > 0 ? localStyles.avatarOverlap : null}
                            >
                                <TouchableOpacity onPress={() => setIsOpen(true)} accessible={false}>
                                    <Avatar reviewerPhotoURL={user.photoURL} borderSize={0} size={32} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        {usersToShow.length > MAX_USERS_TO_SHOW && (
                            <UsersPlusButton
                                usersAmount={usersToShow.length}
                                openModal={() => setIsOpen(true)}
                                maxUsersToShow={MAX_USERS_TO_SHOW}
                            />
                        )}
                    </View>
                </View>
            </Popover>
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
    title: {
        justifyContent: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    container: {
        marginLeft: 16,
        flexDirection: 'row',
    },
    avatarOverlap: {
        marginLeft: -12,
    },
})

export default FilterByUser
