import React, { useMemo, useRef } from 'react'
import { useSelector } from 'react-redux'

import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_ARCHIVED } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectListModal from '../ProjectListModal/ProjectListModal'
import { translate } from '../../../../i18n/TranslationService'
import useMoveObjectToProject from './useMoveObjectToProject'

/**
 * The "move this object to another project" picker, now an adapter over the
 * shared ProjectListModal (MODAL_IMPROVEMENT_PLAN.md, project-picker
 * consolidation — the last tabbed picker to migrate). This component keeps
 * what is specific to the move flow and hands the tabs/list/keyboard/Escape
 * mechanics to the shared modal:
 *
 * - the PLAIN id-set semantics (ProjectHelper.getProjectsByType + the
 *   projectIds membership filter — deliberately NOT merged with
 *   SelectProjectModalInSearch's real* sets; callers own filtering),
 * - the move engine (useMoveObjectToProject) and its ordering: move, then
 *   dismissAllPopups, then closePopover(newProject) — some hosts
 *   (NoteMoreButton) read the argument to know a move actually happened,
 * - picking the CURRENT project just closes without moving.
 */
export default function SelectProjectModal({
    item,
    project,
    closePopover,
    headerText,
    subheaderText,
    onSelectProject,
}) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)
    const moveObjectToProject = useMoveObjectToProject()
    // closePopover's argument is the committed project (or undefined for a
    // plain dismiss); ProjectListModal's closeModal callback carries no args.
    const committedProjectRef = useRef(undefined)

    const { tabs, initialTabIndex } = useMemo(() => {
        const { projectIds } = loggedUser
        const buildTab = type =>
            ProjectHelper.sortProjects(
                ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, type),
                loggedUser.uid
            ).filter(projectItem => projectIds.includes(projectItem.id))

        const tabs = [
            { key: PROJECT_TYPE_ACTIVE, name: 'Active', projects: buildTab(PROJECT_TYPE_ACTIVE) },
            { key: PROJECT_TYPE_ARCHIVED, name: 'Archived', projects: buildTab(PROJECT_TYPE_ARCHIVED) },
        ]
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, project.id)
        return { tabs, initialTabIndex: projectType === PROJECT_TYPE_ARCHIVED ? 1 : 0 }
    }, [loggedUserProjects, loggedUser, project.id])

    const header = headerText || `${translate('Move')} ${translate(item.type)}`
    const subheader =
        subheaderText || translate('Select the project this itemType will move to', { itemType: translate(item.type) })

    const handleSelect = async newProject => {
        committedProjectRef.current = newProject
        if (newProject.id === project.id) return
        if (onSelectProject) onSelectProject()
        await moveObjectToProject(item, project, newProject)
        dismissAllPopups()
    }

    return (
        <ProjectListModal
            closeModal={() => closePopover(committedProjectRef.current)}
            tabs={tabs}
            initialTabIndex={initialTabIndex}
            title={header}
            description={subheader}
            selectedProjectId={project.id}
            onSelectProject={handleSelect}
        />
    )
}
