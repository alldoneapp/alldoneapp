import React from 'react'

import ConnectRepoModal from '../../ConnectRepo/ConnectRepoModal'
import { CONNECT_GITLAB_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import {
    connectGitlabRepo,
    disconnectGitlabRepo,
    getGitlabUserConnection,
} from '../../../../../utils/backends/firestore'

const GITLAB_PROVIDER = {
    modalId: CONNECT_GITLAB_MODAL_ID,
    repoUrlField: 'gitlabRepoUrl',
    baseBranchField: 'gitlabBaseBranch',
    connect: connectGitlabRepo,
    disconnect: disconnectGitlabRepo,
    getConnection: getGitlabUserConnection,
    titleKey: 'GitLab repository',
    descriptionKey: 'GitLab repository description',
    missingUrlKey: 'Please enter the GitLab repository URL.',
    missingTokenKey: 'Please paste a GitLab access token.',
    connectedKey: 'GitLab repository connected.',
    connectFailedKey: 'Could not connect the GitLab repository.',
    disconnectedKey: 'Your GitLab token was removed from this project.',
    disconnectFailedKey: 'Could not disconnect GitLab.',
    readOnlyWarningKey: 'This token is read-only and cannot open Merge Requests.',
    tokenHelpKey: 'Use a Project Access Token with api + write_repository scope (Developer role or higher).',
    repoUrlPlaceholder: 'https://gitlab.com/group/repo',
    tokenPlaceholder: 'glpat-…',
}

export default function ConnectGitLabModal(props) {
    return <ConnectRepoModal {...props} provider={GITLAB_PROVIDER} />
}
