import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { difference } from 'lodash'

import { colors } from '../../../styles/global'
import ModalHeader from '../../../UIComponents/FloatModals/ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import Button from '../../../UIControls/Button'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import SearchForm from '../../../UIComponents/FloatModals/AssigneeAndObserversModal/Form/SearchForm'
import EmptyResults from '../../../UIComponents/FloatModals/EmptyResults'
import SearchHelper from '../../../../utils/SearchHelper'
import SelectedUsersInfo from './SelectedUsersInfo'
import UsersList from './UsersList'
import { getSubscriptionStatus, PLAN_STATUS_PREMIUM } from '../../PremiumHelper'
import PaymentPreviewModal from '../PaymentPreviewModal/PaymentPreviewModal'
import { getUserData } from '../../../../utils/backends/Users/usersFirestore'

export default function SelectPremiumUsersModal({
    closeModal,
    originalSelectedUsersIds,
    onClickButton,
    allowSaveWithoutSelectedUsers,
    subscription,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUser = useSelector(state => state.loggedUser)
    const projectUsers = useSelector(state => state.projectUsers)
    const [tmpSelectedUsersIds, setTmpSelectedUsersIds] = useState(originalSelectedUsersIds)
    const [filterText, setFilterText] = useState('')
    const [showPreviewModal, setShowPreviewModal] = useState(false)
    const [projectsUsersArray, setProjectsUsersArray] = useState([])
    const [loadingUsers, setLoadingUsers] = useState(true)
    const [width, height] = useWindowSize()

    const loadUsers = async () => {
        const userIds = [loggedUser.uid]
        const projectsUsersArray = [loggedUser]
        const usersByProject = Object.values(projectUsers)
        usersByProject.forEach(users => {
            users.forEach(user => {
                if (!userIds.includes(user.uid)) {
                    userIds.push(user.uid)
                    projectsUsersArray.push(user)
                }
            })
        })
        const userIdsToCheckIfAreInOtherProjects = subscription
            ? [...subscription.paidUsersIds, ...difference(subscription.selectedUserIds, subscription.paidUsersIds)]
            : originalSelectedUsersIds
        const inOtherProjectsUserIds = difference(userIdsToCheckIfAreInOtherProjects, userIds)
        if (inOtherProjectsUserIds.length > 0) {
            const promises = []
            inOtherProjectsUserIds.forEach(userId => {
                promises.push(getUserData(userId, false))
            })
            const inOtherProjectsUsers = await Promise.all(promises)
            projectsUsersArray.push(...inOtherProjectsUsers)
        }
        setLoadingUsers(false)
        setProjectsUsersArray(projectsUsersArray)
        setTmpSelectedUsersIds(tmpSelectedUsersIds => {
            const tmpSelectedUsers = projectsUsersArray.filter(user => {
                const paidByOtherUser =
                    user.premium.status === PLAN_STATUS_PREMIUM && user.premium.userPayingId !== loggedUserId
                return !paidByOtherUser && tmpSelectedUsersIds.includes(user.uid)
            })
            return tmpSelectedUsers.map(user => user.uid)
        })
    }

    useEffect(() => {
        loadUsers()
    }, [projectUsers, originalSelectedUsersIds])

    const filterUsersByText = (users, filterText) => {
        return filterText.trim() === ''
            ? users
            : users.filter(user => SearchHelper.matchSearch(user.displayName, filterText))
    }

    const goToNextStep = () => {
        const { isInactiveSubscription, isActiveSubscription, isCanceledSubscription } = getSubscriptionStatus(
            subscription
        )
        if (
            (tmpSelectedUsersIds.length > 0 && (isInactiveSubscription || isCanceledSubscription)) ||
            isActiveSubscription
        ) {
            setShowPreviewModal(true)
        } else {
            onClickButton(tmpSelectedUsersIds)
        }
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter' && (allowSaveWithoutSelectedUsers || tmpSelectedUsersIds.length > 0)) goToNextStep()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const title = 'Select users to be premium'
    const description = 'Select the users you want to be included in the premium subscription'

    const filteredUsers = filterUsersByText(projectsUsersArray, filterText)

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    return showPreviewModal ? (
        <PaymentPreviewModal
            paymentMethod={subscription.paymentMethod}
            closeModal={closeModal}
            selectedUserIds={tmpSelectedUsersIds}
            companyData={subscription.companyData}
            subscription={subscription}
        />
    ) : (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate(title)}
                description={translate(description)}
                containerStyle={{ marginHorizontal: 8 }}
            />
            <View style={{ minHeight: 40, marginBottom: 8, marginHorizontal: 8 }}>
                <SearchForm setText={setFilterText} />
            </View>
            {filteredUsers.length > 0 && (
                <UsersList
                    tmpSelectedUsersIds={tmpSelectedUsersIds}
                    setTmpSelectedUsersIds={setTmpSelectedUsersIds}
                    filteredUsers={filteredUsers}
                />
            )}
            {filteredUsers.length === 0 && (
                <EmptyResults text={loadingUsers ? translate('Loading users') : undefined} />
            )}
            <View style={localStyles.line} />
            <SelectedUsersInfo selectedUsersAmount={tmpSelectedUsersIds.length} />
            <View style={localStyles.buttonContainer}>
                <Button
                    title={translate('Select Premium Users')}
                    type="primary"
                    onPress={goToNextStep}
                    disabled={!allowSaveWithoutSelectedUsers && tmpSelectedUsersIds.length === 0}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 8,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    line: {
        height: 1,
        backgroundColor: colors.Text03,
        opacity: 0.2,
        marginVertical: 8,
        marginHorizontal: -8,
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
})
