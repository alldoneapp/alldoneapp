import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import GlobalXP from './GlobalXP'
import GlobalUserInfo from './GlobalUserInfo'
import GlobalUserPhone from './GlobalUserPhone'
import UserDescriptionField from './UserDescriptionField'
import UserInfo from '../../../UserDetailedView/UserProperties/UserInfo'
import useInProfileSettings from '../useInProfileSettings'
import SharedHelper from '../../../../utils/SharedHelper'
import UserGold from './UserGold'
import GoldTransactionsModal from './GoldTransactionsModal'
import ProjectHelper from '../../ProjectsSettings/ProjectHelper'
import { setUserDescription, setUserDescriptionInProject } from '../../../../utils/backends/Users/usersFirestore'

export default function ProfileProperties({ user, projectId, projectIndex }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const role = useSelector(state => state.loggedUser.role)
    const company = useSelector(state => state.loggedUser.company)
    const description = useSelector(state => state.loggedUser.description)
    const extendedDescription = useSelector(state => state.loggedUser.extendedDescription)
    const phone = useSelector(state => state.loggedUser.phone)
    const inSettings = useInProfileSettings()
    const accessGranted = inSettings ? true : SharedHelper.accessGranted(null, projectId)
    const loggedUserCanUpdateObject =
        inSettings || loggedUserId === user.uid || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const [showGoldTransactions, setShowGoldTransactions] = useState(false)
    const projectDescription = inSettings
        ? extendedDescription || description || ''
        : ProjectHelper.getUserDescriptionInProject(
              projectId,
              user.uid,
              user.description,
              user.extendedDescription,
              true
          )

    return (
        <View>
            <View style={[localStyles.container, smallScreen && localStyles.containerMobile]}>
                <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginRight: smallScreen ? 0 : 36 }}>
                    {inSettings ? (
                        <GlobalUserInfo userId={loggedUserId} role={role} company={company} description={description} />
                    ) : (
                        <UserInfo
                            projectId={projectId}
                            projectIndex={projectIndex}
                            user={user}
                            accessGranted={accessGranted}
                        />
                    )}
                    <Popover
                        content={
                            <GoldTransactionsModal
                                userId={loggedUserId}
                                closeModal={() => setShowGoldTransactions(false)}
                            />
                        }
                        align={'start'}
                        position={['bottom', 'left', 'right', 'top']}
                        onClickOutside={() => setShowGoldTransactions(false)}
                        isOpen={showGoldTransactions}
                        contentLocation={smallScreenNavigation ? null : undefined}
                    >
                        <UserGold
                            gold={user.gold}
                            onPress={
                                inSettings
                                    ? () => {
                                          setShowGoldTransactions(true)
                                      }
                                    : undefined
                            }
                        />
                    </Popover>
                </View>
                <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginLeft: smallScreen ? 0 : 36 }}>
                    <GlobalXP user={user} />
                    {inSettings && <GlobalUserPhone userId={loggedUserId} phone={phone} />}
                </View>
            </View>
            {(inSettings || accessGranted) && (
                <UserDescriptionField
                    description={projectDescription}
                    projectId={inSettings ? null : projectId}
                    projectIndex={inSettings ? null : projectIndex}
                    disabled={!loggedUserCanUpdateObject}
                    helperText={
                        inSettings ? 'Global user description helper text' : 'Project user description helper text'
                    }
                    onSave={newDescription =>
                        inSettings
                            ? setUserDescription(loggedUserId, newDescription)
                            : setUserDescriptionInProject(
                                  loggedUserProjectsMap[projectId],
                                  user,
                                  newDescription,
                                  projectDescription
                              )
                    }
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginTop: 32,
    },
    containerMobile: {
        flexDirection: 'column',
    },
})
