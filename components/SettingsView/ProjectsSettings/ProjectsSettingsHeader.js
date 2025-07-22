import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import MultiToggleSwitch from '../../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { setProjectTypeSectionIndex } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'
import ProjectHeaderMoreButton from './Sorting/ProjectHeaderMoreButton'
import { PROJECT_TYPE_ACTIVE } from './ProjectsSettings'

export default function ProjectsSettingsHeader({ amount = 0, projectType }) {
    const dispatch = useDispatch()
    const projectTypeSectionIndex = useSelector(state => state.projectTypeSectionIndex)

    const parseText = number => {
        if (number == null || number <= 0) {
            return translate('No projects yet')
        } else if (number > 1) {
            return number + ` ${translate('projects')}`
        }
        return number + ` ${translate('project')}`
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerInfo}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Projects')}</Text>
                <View style={localStyles.headerCaption}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(amount)}</Text>
                </View>
                {projectType === PROJECT_TYPE_ACTIVE && (
                    <View style={localStyles.dots}>
                        <ProjectHeaderMoreButton projectType={projectType} />
                    </View>
                )}
            </View>

            <View>
                <MultiToggleSwitch
                    options={[
                        { text: 'Active', icon: 'circle' },
                        { text: 'Community', icon: 'map' },
                        { text: 'Archived', icon: 'archive' },
                    ]}
                    currentIndex={projectTypeSectionIndex}
                    onChangeOption={sectionIndex => {
                        dispatch(setProjectTypeSectionIndex(sectionIndex))
                    }}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        maxHeight: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row',
    },
    headerInfo: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
    dots: { height: 28, justifyContent: 'center' },
})
