import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'

import { SIDEBAR_MENU_WIDTH } from '../../../styles/global'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_ARCHIVED,
    PROJECT_TYPE_GUIDE,
    PROJECT_TYPE_SHARED,
    PROJECT_TYPE_TEMPLATE,
} from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ProjectListModal from '../ProjectListModal/ProjectListModal'
import { ALL_ARCHIVED_PROJECTS_OPTION, ALL_PROJECTS_OPTION } from './projectPickerConstants'
import { translate } from '../../../../i18n/TranslationService'

export { ALL_PROJECTS_OPTION, ALL_ARCHIVED_PROJECTS_OPTION }

/**
 * The search-scope project picker, now an adapter over the shared
 * ProjectListModal (MODAL_IMPROVEMENT_PLAN.md, project-picker consolidation).
 * This component keeps everything that is specific to the search flows and
 * hands the list/tabs/keyboard/Escape mechanics to the shared modal:
 *
 * - the `real*` id-set semantics (realGuideProjectIds etc. — deliberately NOT
 *   merged with SelectProjectModal's plain sets; callers own filtering),
 * - the ALL_PROJECTS_OPTION sentinel row on the Active tab (or, for the add-task
 *   flow, the AUTOMATIC_PROJECT_OPTION row — see AT-2306),
 * - the sidebar offset its fixed-overlay hosts expect.
 *
 * Escape lives on the LIFO escape stack via the shared modal's close button
 * (AT-2257: it must win the key over the search modal underneath).
 */
export default function SelectProjectModalInSearch({
    projectId,
    closePopover,
    projects,
    setSelectedProjectId,
    headerText,
    subheaderText,
    positionInPlace,
    showGuideTab,
    showTemplateTab,
    showArchivedTab,
    showAllProjects,
    showAllArchivedProjects,
    showAutomaticProject,
    widthStyle,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const { tabs, initialTabIndex } = useMemo(() => {
        const { realGuideProjectIds, realTemplateProjectIds, realArchivedProjectIds, projectIds } = loggedUser

        const byType = {
            [PROJECT_TYPE_ACTIVE]: projects.filter(
                project =>
                    !realGuideProjectIds.includes(project.id) &&
                    !realTemplateProjectIds.includes(project.id) &&
                    !realArchivedProjectIds.includes(project.id)
            ),
            [PROJECT_TYPE_GUIDE]: projects.filter(project => realGuideProjectIds.includes(project.id)),
            [PROJECT_TYPE_TEMPLATE]: projects.filter(project => realTemplateProjectIds.includes(project.id)),
            [PROJECT_TYPE_ARCHIVED]: projects.filter(project => realArchivedProjectIds.includes(project.id)),
        }

        // AT-2390: with "All archived" offered on the Archived tab, the leading
        // row is per tab rather than "first tab only". Declaring it on the
        // Active tab too is what keeps ProjectListModal's per-tab mechanism in
        // charge of the slot (see its header comment) — the two mechanisms are
        // deliberately not mixed.
        const activeTabLeadingOptionId = showAllArchivedProjects && showAllProjects ? ALL_PROJECTS_OPTION : undefined

        const tabs = [
            {
                key: PROJECT_TYPE_ACTIVE,
                name: 'Active',
                projects: ProjectHelper.sortProjects(byType[PROJECT_TYPE_ACTIVE], loggedUser.uid),
                leadingOptionId: activeTabLeadingOptionId,
            },
        ]
        if (showGuideTab)
            tabs.push({
                key: PROJECT_TYPE_GUIDE,
                name: 'Community',
                projects: ProjectHelper.sortProjects(byType[PROJECT_TYPE_GUIDE], loggedUser.uid),
            })
        if (showTemplateTab)
            tabs.push({
                key: PROJECT_TYPE_TEMPLATE,
                name: 'Template',
                projects: ProjectHelper.sortProjects(byType[PROJECT_TYPE_TEMPLATE], loggedUser.uid),
            })
        if (showArchivedTab)
            tabs.push({
                key: PROJECT_TYPE_ARCHIVED,
                name: 'Archived',
                projects: ProjectHelper.sortProjects(byType[PROJECT_TYPE_ARCHIVED], loggedUser.uid),
                leadingOptionId: showAllArchivedProjects ? ALL_ARCHIVED_PROJECTS_OPTION : undefined,
            })

        const selectedType =
            projectId === ALL_ARCHIVED_PROJECTS_OPTION
                ? PROJECT_TYPE_ARCHIVED
                : realGuideProjectIds.includes(projectId)
                  ? PROJECT_TYPE_GUIDE
                  : realTemplateProjectIds.includes(projectId)
                    ? PROJECT_TYPE_TEMPLATE
                    : realArchivedProjectIds.includes(projectId)
                      ? PROJECT_TYPE_ARCHIVED
                      : projectIds.includes(projectId)
                        ? PROJECT_TYPE_ACTIVE
                        : PROJECT_TYPE_SHARED
        const tabIndex = tabs.findIndex(tab => tab.key === selectedType)

        return { tabs, initialTabIndex: tabIndex >= 0 ? tabIndex : 0 }
    }, [
        projects,
        projectId,
        loggedUser,
        showGuideTab,
        showTemplateTab,
        showArchivedTab,
        showAllProjects,
        showAllArchivedProjects,
    ])

    const sidebarOpenStyle = smallScreenNavigation || positionInPlace ? null : { marginLeft: SIDEBAR_MENU_WIDTH }

    return (
        <ProjectListModal
            closeModal={closePopover}
            tabs={tabs}
            initialTabIndex={initialTabIndex}
            leadingAllOption={!!showAllProjects}
            leadingAutomaticOption={!!showAutomaticProject}
            title={headerText || translate('Select search scope')}
            description={subheaderText || translate('Select an option to define the search scope')}
            onSelectProject={project => {
                setSelectedProjectId(project.id)
            }}
            selectedProjectId={projectId}
            widthStyle={widthStyle}
            containerStyle={sidebarOpenStyle}
        />
    )
}
