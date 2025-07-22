import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import ChangeContactInfoModal from '../../UIComponents/FloatModals/ChangeContactInfoModal'
import { translate } from '../../../i18n/TranslationService'

export default function UserInfo({ projectId, projectIndex, user, accessGranted }) {
    const [showInfoModal, setShowInfoModal] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const { uid: userId, role, company, description, extendedDescription } = user

    const userRole = ProjectHelper.getUserRoleInProject(projectId, userId, role)
    const userCompany = ProjectHelper.getUserCompanyInProject(projectId, userId, company)
    const userDescription = ProjectHelper.getUserDescriptionInProject(
        projectId,
        userId,
        description,
        extendedDescription,
        false
    )

    const userInfo =
        !userRole && !userCompany
            ? userDescription
                ? userDescription
                : ''
            : `${userRole ? userRole : ''}${userRole && userCompany ? ' • ' : ''}${userCompany ? userCompany : ''}`

    const showModal = () => {
        setShowInfoModal(true)
    }

    const hideModal = () => {
        setShowInfoModal(false)
    }

    const changePropertyValue = async (property, value) => {
        if (property === 'info') {
            await ProjectHelper.setUserInfoInProject(
                projectId,
                projectIndex,
                userId,
                value.company.trim(),
                value.role.trim(),
                value.description.trim()
            )
        }
    }

    const userIsLoggedUser = loggedUserId === userId
    const loggedUserCanUpdateObject = userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={localStyles.propertyRow}>
            <View
                style={[
                    localStyles.propertyRowSection,
                    localStyles.propertyRowLeft,
                    !smallScreenNavigation && { marginRight: 24 },
                ]}
            >
                <Icon name={'info'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {smallScreenNavigation && userInfo !== '' ? (
                    <Text style={styles.body1} numberOfLines={1}>
                        {userInfo}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Info')}
                    </Text>
                )}
            </View>
            <View
                style={[
                    localStyles.propertyRowSection,
                    localStyles.propertyRowRight,
                    smallScreenNavigation ? { marginLeft: 32 } : null,
                ]}
            >
                {!smallScreenNavigation && userInfo !== '' && (
                    <Text style={[styles.body1, { marginHorizontal: 8 }]} numberOfLines={1}>
                        {userInfo}
                    </Text>
                )}

                <Popover
                    content={
                        <ChangeContactInfoModal
                            projectId={projectId}
                            closePopover={hideModal}
                            onSaveData={value => changePropertyValue('info', value)}
                            currentRole={userRole ? userRole : ''}
                            currentCompany={userCompany ? userCompany : ''}
                            currentDescription={userDescription ? userDescription : ''}
                            disabled={!loggedUserCanUpdateObject}
                        />
                    }
                    onClickOutside={hideModal}
                    isOpen={showInfoModal}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={smallScreen ? null : undefined}
                >
                    <Button icon={'edit'} type={'ghost'} onPress={showModal} disabled={!accessGranted} />
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
        flex: 1,
        justifyContent: 'flex-end',
    },
})
