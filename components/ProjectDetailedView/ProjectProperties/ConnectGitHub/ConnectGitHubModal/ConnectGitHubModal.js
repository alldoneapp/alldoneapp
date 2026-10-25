import React from 'react'

import ConnectRepoModal from '../../ConnectRepo/ConnectRepoModal'
import { CONNECT_GITHUB_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import {
    connectGithubRepo,
    disconnectGithubRepo,
    getGithubUserConnection,
} from '../../../../../utils/backends/firestore'

const GITHUB_PROVIDER = {
    modalId: CONNECT_GITHUB_MODAL_ID,
    repoUrlField: 'githubRepoUrl',
    baseBranchField: 'githubBaseBranch',
    connect: connectGithubRepo,
    disconnect: disconnectGithubRepo,
    getConnection: getGithubUserConnection,
    titleKey: 'GitHub repository',
    descriptionKey: 'GitHub repository description',
    missingUrlKey: 'Please enter the GitHub repository URL.',
    missingTokenKey: 'Please paste a GitHub access token.',
    connectedKey: 'GitHub repository connected.',
    connectFailedKey: 'Could not connect the GitHub repository.',
    disconnectedKey: 'Your GitHub token was removed from this project.',
    disconnectFailedKey: 'Could not disconnect GitHub.',
    readOnlyWarningKey: 'This token is read-only and cannot open Pull Requests.',
    tokenHelpKey:
        'Use a fine-grained Personal Access Token with Contents + Pull requests read/write (or a classic token with the repo scope).',
    repoUrlPlaceholder: 'https://github.com/owner/repo',
    tokenPlaceholder: 'github_pat_… / ghp_…',
}

export default function ConnectGitHubModal(props) {
    return <ConnectRepoModal {...props} provider={GITHUB_PROVIDER} />
}
