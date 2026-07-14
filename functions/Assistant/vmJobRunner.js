const admin = require('firebase-admin')
const crypto = require('crypto')
const { getEnvFunctions } = require('../envFunctionsHelper')
const {
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    FEED_PUBLIC_FOR_ALL,
    STAYWARD_COMMENT,
    getBaseUrl,
} = require('../Utils/HelperFunctionsCloud')
const {
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
    cleanTextMetaData,
    removeFormatTagsFromText,
    shrinkTagText,
} = require('../Utils/parseTextUtils')
const {
    VM_JOB_GOLD_SOURCE,
    VM_JOB_GOLD_REFUND_SOURCE,
    VM_GOLD_PER_MINUTE,
    VM_TOKENS_PER_GOLD,
    getAgentLabel,
    formatAgentRunSuffix,
    formatVmBillingStatus,
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CLAUDE_EFFORT_LEVEL,
    DEFAULT_CODEX_REASONING_EFFORT,
} = require('./vmJob')
const { MAX_VM_RUNTIME_MS, E2B_SANDBOX_TERMINATION_GRACE_MS, E2B_SANDBOX_TIMEOUT_MS } = require('./vmJobConfig')

// Don't refresh the live status comment more often than this (Firestore write rate).
const PROGRESS_UPDATE_INTERVAL_MS = 3000
// Runtime Gold is charged while the VM is running. The interval can fire twice per
// billable minute; only newly accrued whole-minute charges are deducted.
const VM_GOLD_MONITOR_INTERVAL_MS = 30 * 1000
const VM_GOLD_EXHAUSTED_FAILURE_REASON = 'insufficient_gold'
const VM_GOLD_EXHAUSTED_TEXT =
    '🛑 VM task stopped because you ran out of Gold. Add Gold and start a new VM task to continue.'
const VM_JOB_CANCELLED_STATUS = 'cancelled'
const VM_JOB_CANCEL_REQUESTED_STATUS = 'cancel_requested'
const VM_JOB_CANCELLED_TEXT = 'Stopped.'
const VM_RUNTIME_TIMEOUT_FAILURE_REASON = 'runtime_timeout'
const VM_JOB_HEARTBEAT_INTERVAL_MS = 30 * 1000
const VM_JOB_LEASE_MS = 2 * 60 * 1000
const CODEX_AUTH_DIR = '/home/user/.codex'
const CODEX_AUTH_PATH = `${CODEX_AUTH_DIR}/auth.json`
const AGENT_CLI_NPM_PREFIX = '/home/user/.local'
// E2B's managed images may ship /home/user/.npm from an immutable/root-owned
// layer, while Codex's nested workspace sandbox only guarantees writes below the
// checkout and /tmp. Use a per-sandbox temp cache that works in both layers. This
// environment is inherited by the agent, so repository-level npm install/ci
// commands use the writable cache from their first attempt too.
const VM_NPM_CACHE_DIR = '/tmp/alldone-npm-cache'
const MAX_BOOTSTRAP_DIAGNOSTIC_CHARS = 16 * 1024

// Persistent per-thread VM session: after a run we PAUSE the sandbox (snapshotting its
// filesystem + the agent's session store) and save its id on a vmSessions doc keyed by the
// chat thread, so the next run in that thread resumes it and the agent continues. Paused
// sandboxes are deleted after this idle window. (e2b@1.x has no pause() method, so we call
// the pause + resume REST endpoints directly (connect alone won't resume a paused sandbox),
// then Sandbox.connect() to attach; cleanup is Sandbox.kill().)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days idle before a paused session is deleted
const E2B_API_BASE = 'https://api.e2b.dev'

// Keep-alive: after a run we leave the sandbox RUNNING (not paused) for a grace window so
// back-to-back tasks in a thread hit a live VM (instant, no resume). The `pauseIdleVmSessions`
// scheduler pauses sessions idle longer than the grace window. The sandbox's own self-kill
// timeout is set comfortably ABOVE the grace window + scheduler interval so the pauser always
// pauses (preserving state) before E2B would kill the idle VM.
const KEEP_ALIVE_GRACE_MS = 10 * 60 * 1000 // pause after 10 min idle
const KEEP_ALIVE_KILL_MS = 15 * 60 * 1000 // sandbox self-kill timeout (> grace + 2-min pauser interval)

// Per-task-type guidance prepended to the agent's objective.
const TASK_TYPE_PROFILES = {
    research:
        'You are an autonomous research agent. Do thorough multi-source web research and produce a clear, well-structured written report with sources.',
    document:
        'You are an autonomous agent that produces polished documents. Generate the requested deliverable (document, spreadsheet, or slides) and summarize what you produced.',
    prototype:
        'You are an autonomous coding agent. Write working code / a small prototype to satisfy the objective, then explain what you built and how to run it.',
    data:
        'You are an autonomous data agent. Acquire, clean and analyze the relevant data, then report the findings with any key figures.',
}

// --- Git repository integration (optional, per-project; GitLab or GitHub) ---
// When the project has a repo connected AND the requesting user has stored a token, a coding
// ("prototype") task runs inside an authenticated checkout of that repo and opens a Merge
// Request (GitLab) / Pull Request (GitHub). SECURITY: the token is passed to the sandbox ONLY
// as a per-command env var (the e2b `envs` option) — never written to disk, prompt.txt, or the
// paused-session snapshot. The git credential helper we configure stores only a reference to
// $GIT_TOKEN, not the token itself, so resuming a paused sandbox never leaks it.
const REPO_DIR = '/home/user/repo'
// Codex's workspace-write sandbox intentionally protects a checkout's `.git` path as
// read-only. Keep Git's mutable refs, index, and locks in one dedicated directory outside
// the worktree instead of weakening the entire inner sandbox. The runner creates/migrates
// this directory before Codex starts and grants only its parent as an extra writable root.
const GIT_METADATA_ROOT = '/home/user/git-metadata'
const GIT_METADATA_DIR = `${GIT_METADATA_ROOT}/repo`

function formatVmRuntimeDuration(runtimeMs = MAX_VM_RUNTIME_MS) {
    const minutes = runtimeMs / (60 * 1000)
    if (Number.isInteger(minutes) && minutes >= 60 && minutes % 60 === 0) {
        const hours = minutes / 60
        return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
    }
    return Number.isInteger(minutes) ? `${minutes} minutes` : `${Math.round(minutes * 10) / 10} minutes`
}

function buildVmRuntimeTimeoutText(runtimeMs = MAX_VM_RUNTIME_MS) {
    return `❌ The VM task exceeded its allowed execution time of ${formatVmRuntimeDuration(
        runtimeMs
    )}. Start a new VM task to continue.`
}

class VmRuntimeTimeoutError extends Error {
    constructor(runtimeMs = MAX_VM_RUNTIME_MS, cause = null) {
        super(buildVmRuntimeTimeoutText(runtimeMs).replace(/^❌\s*/, ''))
        this.name = 'VmRuntimeTimeoutError'
        this.code = VM_RUNTIME_TIMEOUT_FAILURE_REASON
        this.runtimeMs = runtimeMs
        if (cause) this.cause = cause
    }
}

function isE2bSandboxTimeout(error) {
    const message = String(error?.message || error || '').trim()
    const normalizedMessage = message.toLowerCase()
    return (
        /^2:\s*\[unknown\]\s*terminated$/i.test(message) ||
        normalizedMessage.includes('deadline exceeded') ||
        normalizedMessage.includes('command timed out') ||
        normalizedMessage.includes('command timeout') ||
        normalizedMessage.includes('sandbox timed out') ||
        normalizedMessage.includes('sandbox timeout')
    )
}

function isVmRuntimeTimeoutError(error) {
    return !!error && (error.code === VM_RUNTIME_TIMEOUT_FAILURE_REASON || error instanceof VmRuntimeTimeoutError)
}

function normalizeVmCommandError(error, runtimeMs = MAX_VM_RUNTIME_MS) {
    if (isVmRuntimeTimeoutError(error)) return error
    return isE2bSandboxTimeout(error) ? new VmRuntimeTimeoutError(runtimeMs, error) : error
}

function selectVmCommandError(runError, detailedError, runtimeMs = MAX_VM_RUNTIME_MS) {
    const normalizedError = normalizeVmCommandError(runError, runtimeMs)
    return isVmRuntimeTimeoutError(normalizedError) ? normalizedError : detailedError
}

function resolveVmAgentRuntimeMs(sandboxLeaseDeadlineMs, nowMs = Date.now()) {
    if (sandboxLeaseDeadlineMs == null) return MAX_VM_RUNTIME_MS
    const remainingLeaseMs = Number(sandboxLeaseDeadlineMs) - Number(nowMs)
    if (!Number.isFinite(remainingLeaseMs)) return MAX_VM_RUNTIME_MS
    return Math.max(1000, Math.min(MAX_VM_RUNTIME_MS, remainingLeaseMs - E2B_SANDBOX_TERMINATION_GRACE_MS))
}

function startVmRuntimeTimeout(commandHandle, runtimeMs = MAX_VM_RUNTIME_MS, reportedRuntimeMs = runtimeMs) {
    let timer = null
    const promise = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            try {
                Promise.resolve(commandHandle.kill()).catch(() => {})
            } catch (_) {
                // The typed timeout still needs to win even if E2B already removed the command.
            }
            reject(new VmRuntimeTimeoutError(reportedRuntimeMs))
        }, runtimeMs)
    })
    return {
        promise,
        stop: () => {
            if (timer) clearTimeout(timer)
            timer = null
        },
    }
}

async function claimVmJobLease(pendingRef, correlationId) {
    const db = admin.firestore()
    const now = Date.now()
    const leaseOwner = process.env.CLOUD_RUN_EXECUTION || `${correlationId}-${crypto.randomUUID()}`
    const claimed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(pendingRef)
        if (!snapshot.exists) return false
        const data = snapshot.data() || {}
        if (['completed', 'failed', 'cancelled', VM_JOB_CANCEL_REQUESTED_STATUS].includes(data.status)) return false
        if (data.status === 'initiated' && Number(data.leaseExpiresAt) > now && data.leaseOwner !== leaseOwner) {
            return false
        }
        transaction.set(
            pendingRef,
            {
                status: 'initiated',
                initiatedAt: data.initiatedAt || now,
                heartbeatAt: now,
                leaseExpiresAt: now + VM_JOB_LEASE_MS,
                leaseOwner,
            },
            { merge: true }
        )
        return true
    })
    return { claimed, leaseOwner }
}

function startVmJobHeartbeat(pendingRef, leaseOwner) {
    let stopped = false
    let writing = false
    let leaseLost = false
    const tick = async () => {
        if (stopped || writing) return
        writing = true
        const now = Date.now()
        try {
            const renewed = await admin.firestore().runTransaction(async transaction => {
                const snapshot = await transaction.get(pendingRef)
                const data = snapshot.exists ? snapshot.data() || {} : {}
                if (data.status !== 'initiated' || data.leaseOwner !== leaseOwner) return false
                transaction.set(
                    pendingRef,
                    { heartbeatAt: now, leaseExpiresAt: now + VM_JOB_LEASE_MS },
                    { merge: true }
                )
                return true
            })
            if (!renewed) {
                leaseLost = true
                stopped = true
                clearInterval(timer)
                console.warn('🖥️ VM JOB: lease lost; heartbeat stopped', { leaseOwner })
            }
        } catch (error) {
            console.warn('🖥️ VM JOB: heartbeat update failed', { error: error.message })
        } finally {
            writing = false
        }
    }
    const timer = setInterval(tick, VM_JOB_HEARTBEAT_INTERVAL_MS)
    return {
        stop: () => {
            stopped = true
            clearInterval(timer)
        },
        hasLostLease: () => leaseLost,
    }
}

function uniqueDefined(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(value => !!value)))
}

function buildSandboxCommandEnv(...environments) {
    return Object.assign({}, ...environments.filter(environment => environment && typeof environment === 'object'), {
        // Apply last so a template or credential environment cannot accidentally
        // restore npm's read-only default cache.
        NPM_CONFIG_CACHE: VM_NPM_CACHE_DIR,
    })
}

function getVmParentObjectPath(projectId, objectType, objectId) {
    switch (objectType) {
        case 'assistants':
            return `assistants/${projectId}/items/${objectId}`
        case 'contacts':
            return `projectsContacts/${projectId}/contacts/${objectId}`
        case 'goals':
            return `goals/${projectId}/items/${objectId}`
        case 'notes':
            return `noteItems/${projectId}/notes/${objectId}`
        case 'skills':
            return `skills/${projectId}/items/${objectId}`
        case 'tasks':
            return `items/${projectId}/tasks/${objectId}`
        default:
            return null
    }
}

function buildVmChatLink(projectId, objectType, objectId) {
    return `${getBaseUrl()}/projects/${projectId}/${objectType === 'topics' ? 'chats' : objectType}/${objectId}/chat`
}

async function resolveVmCompletionFollowers(pendingWebhook) {
    const { projectId, objectType = 'tasks', objectId, assistantId, isPublicFor = [] } = pendingWebhook
    let followerIds = []
    try {
        const { getObjectFollowersIds } = require('../Feeds/globalFeedsHelper')
        followerIds = await getObjectFollowersIds(projectId, objectType, objectId)
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed resolving followers for completion metadata', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
    }

    const visibleToAll = Array.isArray(isPublicFor) && isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    const visibleFollowerIds = visibleToAll
        ? followerIds
        : followerIds.filter(followerId => !Array.isArray(isPublicFor) || isPublicFor.includes(followerId))

    return uniqueDefined([...(visibleFollowerIds || []), ...(pendingWebhook.userIdsToNotify || [])]).filter(
        followerId => followerId !== assistantId
    )
}

async function applyVmCompletionMetadata(pendingWebhook, commentId, text) {
    const { projectId, objectType = 'tasks', objectId, assistantId } = pendingWebhook
    if (!projectId || !objectId || !assistantId || !commentId) return { applied: false, reason: 'missing-context' }

    const db = admin.firestore()
    const now = Date.now()
    const userIdsToNotify = uniqueDefined([...(pendingWebhook.userIdsToNotify || []), pendingWebhook.userId])
    const followerIds = await resolveVmCompletionFollowers(pendingWebhook)
    const notificationUsers = uniqueDefined(userIdsToNotify)
    const lastComment = cleanTextMetaData(removeFormatTagsFromText(text), true)
    const parentLastComment = shrinkTagText(lastComment, LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN)
    const commentRef = db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
    const chatRef = db.doc(`chatObjects/${projectId}/chats/${objectId}`)
    const parentObjectPath = getVmParentObjectPath(projectId, objectType, objectId)
    const parentRef = parentObjectPath ? db.doc(parentObjectPath) : null
    const projectRef = db.doc(`projects/${projectId}`)
    const assistantRef = db.doc(`assistants/${projectId}/items/${assistantId}`)

    return db.runTransaction(async transaction => {
        const [commentSnap, chatSnap, parentSnap, projectSnap, assistantSnap] = await Promise.all([
            transaction.get(commentRef),
            transaction.get(chatRef),
            parentRef ? transaction.get(parentRef) : Promise.resolve(null),
            transaction.get(projectRef),
            transaction.get(assistantRef),
        ])

        if (commentSnap.exists && commentSnap.data()?.vmCompletionMetadataAppliedAt) {
            return { applied: false, reason: 'already-applied' }
        }

        const chat = chatSnap.exists ? chatSnap.data() || {} : {}
        const project = projectSnap && projectSnap.exists ? projectSnap.data() || {} : {}
        const assistant = assistantSnap && assistantSnap.exists ? assistantSnap.data() || {} : {}
        const members = uniqueDefined([...(chat.members || []), ...notificationUsers, assistantId])
        const followersMap = {}
        followerIds.forEach(followerId => {
            followersMap[followerId] = true
        })

        transaction.set(
            commentRef,
            {
                vmCompletionMetadataAppliedAt: now,
                vmCompletionNotificationUserIds: notificationUsers,
            },
            { merge: true }
        )

        transaction.set(
            chatRef,
            {
                members,
                lastEditionDate: now,
                lastEditorId: assistantId,
                lastAssistantComment: now,
                assistantId,
                followerIds,
                [`commentsData.lastCommentOwnerId`]: assistantId,
                [`commentsData.lastComment`]: lastComment,
                [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
                [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
            },
            { merge: true }
        )

        if (parentRef && parentSnap && parentSnap.exists) {
            transaction.update(parentRef, {
                [`commentsData.lastComment`]: parentLastComment,
                [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
                [`commentsData.amount`]: admin.firestore.FieldValue.increment(1),
            })
        }

        const updateDate = {
            objectType,
            objectId,
            creatorId: assistantId,
            creatorType: 'assistant',
            date: now,
        }
        followerIds.forEach(followerId => {
            transaction.set(
                db.doc(`users/${followerId}`),
                {
                    [`lastAssistantCommentData.${projectId}`]: updateDate,
                    [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                        ...updateDate,
                        projectId,
                    },
                },
                { merge: true }
            )
        })

        notificationUsers.forEach(userId => {
            transaction.set(db.doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
                chatId: objectId,
                chatType: objectType,
                followed: !!followersMap[userId],
                date: now,
                creatorId: assistantId,
                creatorType: 'assistant',
            })
        })

        transaction.set(
            db.doc(`emailNotifications/${objectId}`),
            {
                userIds: followerIds,
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName: chat.title || 'Task',
                messageTimestamp: now,
            },
            { merge: true }
        )

        if (followerIds.length > 0) {
            transaction.set(db.doc(`pushNotifications/${commentId}`), {
                userIds: followerIds,
                body: `${project.name || projectId}\n  ✔ ${chat.title || 'Task'}\n ${
                    assistant.displayName || assistant.name || 'Assistant'
                } commented: ${lastComment}`,
                link: buildVmChatLink(projectId, objectType, objectId),
                messageTimestamp: now,
                type: 'Chat Notification',
                chatId: objectId,
                projectId,
                initiatorId: pendingWebhook.userId || notificationUsers[0] || null,
            })
        }

        return { applied: true, followerIds, userIdsToNotify: notificationUsers }
    })
}

// Static setup script. ALL dynamic values arrive via env vars (so nothing untrusted is
// interpolated into the script text — no shell injection). The credential helper is
// single-quoted so $GIT_TOKEN is resolved by git at push time from the live env, not baked
// into ~/.gitconfig (GitLab auths as oauth2:<token>, GitHub as x-access-token:<token>). Fresh
// start: clone + checkout the base branch. On a resumed thread the repo already exists, so we
// only fetch (and leave the agent's working state intact) so a conversational follow-up
// continues on the same branch the agent left.
//
// git is ensured at RUNTIME (not via the E2B template): the worker runs on E2B's prebuilt
// `claude`/`codex` templates by default — our custom template (functions/e2b-template) is only
// used if E2B_*_TEMPLATE overrides point at it — so we can't assume git is baked in. This
// mirrors the per-agent installGuard pattern. (gh is NOT ensured here: the GitHub PR step has a
// REST-API-via-curl fallback in the prompt, so it works whether or not gh is present.)
const GIT_SETUP_SCRIPT = `set -e
if ! command -v git >/dev/null 2>&1; then
  (sudo apt-get update && sudo apt-get install -y git) >/dev/null 2>&1 || (apt-get update && apt-get install -y git) >/dev/null 2>&1 || true
fi
command -v git >/dev/null 2>&1 || { echo "git is not available in this sandbox and could not be installed automatically" >&2; exit 3; }
git config --global credential.helper '!f() { echo "username=$GIT_CRED_USERNAME"; echo "password=$GIT_TOKEN"; }; f'
git config --global user.name "$GIT_USER_NAME"
git config --global user.email "$GIT_USER_EMAIL"
git config --global advice.detachedHead false
fresh_checkout=false
mkdir -p "$(dirname "$GIT_DIR")"
if [ -d "$GIT_DIR" ]; then
  : # Resumed checkout already using sandbox-compatible Git metadata.
elif [ -d "$GIT_WORK_TREE/.git" ]; then
  # Transparently migrate sessions created before Git metadata was separated.
  mv "$GIT_WORK_TREE/.git" "$GIT_DIR"
else
  # clone must not inherit the target GIT_DIR/GIT_WORK_TREE or Git treats the checkout
  # destination itself as a bare metadata directory.
  env -u GIT_DIR -u GIT_WORK_TREE git clone "$GIT_REPO_URL" "$GIT_WORK_TREE"
  mv "$GIT_WORK_TREE/.git" "$GIT_DIR"
  fresh_checkout=true
fi
cd "$GIT_WORK_TREE"
git config core.worktree "$GIT_WORK_TREE"
git remote set-url origin "$GIT_REPO_URL"
if [ "$fresh_checkout" = true ]; then
  git checkout "$GIT_BASE_BRANCH" 2>/dev/null || true
else
  git fetch origin --prune
fi
mkdir -p "$GIT_DIR/info"
grep -qxF "node_modules/" "$GIT_DIR/info/exclude" 2>/dev/null || printf "\\nnode_modules/\\n" >> "$GIT_DIR/info/exclude"
echo "GIT_SETUP_OK $(git rev-parse --abbrev-ref HEAD)"
`

// Build the provider-specific context from a project's repo config + a user token doc.
// GitLab auths git as oauth2:<token> and opens MRs; GitHub auths as x-access-token:<token>
// and opens PRs (via the gh CLI / REST API).
function buildProviderContext(provider, repoUrl, project, tokenData) {
    if (provider === 'github') {
        const login = tokenData.username || ''
        return {
            enabled: true,
            provider: 'github',
            repoUrl,
            baseBranch: (project.githubBaseBranch || 'main').trim() || 'main',
            token: tokenData.token,
            credentialUsername: 'x-access-token',
            identityName: login || 'Alldone Assistant',
            identityEmail: tokenData.email || (login ? `${login}@users.noreply.github.com` : 'assistant@alldone.app'),
            apiBase: project.githubApiBase || 'https://api.github.com',
            repoSlug: tokenData.repoSlug || '',
        }
    }
    return {
        enabled: true,
        provider: 'gitlab',
        repoUrl,
        baseBranch: (project.gitlabBaseBranch || 'main').trim() || 'main',
        token: tokenData.token,
        credentialUsername: 'oauth2',
        identityName: tokenData.username || 'Alldone Assistant',
        identityEmail: tokenData.email || 'assistant@alldone.app',
    }
}

// Read the project's connected repo (GitHub or GitLab) + the requesting user's token. Returns
// an { enabled: true, provider, ... } context only when a repo is connected AND the user has a
// token for it; { enabled: false, repoConnectedButNoToken: true } when a repo is connected but
// the user hasn't linked a token; otherwise null. Best-effort — never throws. GitHub is
// preferred if both providers happen to be connected on the same project.
async function loadRepoContext(vmJob) {
    try {
        const db = admin.firestore()
        const projectSnap = await db.doc(`projects/${vmJob.projectId}`).get()
        if (!projectSnap.exists) return null
        const project = projectSnap.data() || {}
        const userId = vmJob.requestUserId
        if (!userId) return null

        const providers = [
            { name: 'github', url: (project.githubRepoUrl || '').trim() },
            { name: 'gitlab', url: (project.gitlabRepoUrl || '').trim() },
        ].filter(p => p.url)
        if (!providers.length) return null

        for (const p of providers) {
            const tokenSnap = await db.doc(`users/${userId}/private/${p.name}Auth_${vmJob.projectId}`).get()
            const tokenData = tokenSnap.exists ? tokenSnap.data() || {} : {}
            if (tokenData.token) {
                tokenSnap.ref.set({ lastUsed: Date.now() }, { merge: true }).catch(() => {})
                return buildProviderContext(p.name, p.url, project, tokenData)
            }
        }
        // A repo is connected for the project, but THIS user hasn't linked their own token.
        return { enabled: false, repoConnectedButNoToken: true }
    } catch (error) {
        console.warn('🖥️ VM JOB: failed loading repo context', {
            correlationId: vmJob.correlationId,
            error: error.message,
        })
        return null
    }
}

// The per-command env carrying the git credentials + identity into the sandbox.
function buildGitEnv(gitContext) {
    const env = {
        GIT_TOKEN: gitContext.token,
        GIT_CRED_USERNAME: gitContext.credentialUsername || 'oauth2',
        GIT_REPO_URL: gitContext.repoUrl,
        GIT_BASE_BRANCH: gitContext.baseBranch,
        GIT_USER_NAME: gitContext.identityName,
        GIT_USER_EMAIL: gitContext.identityEmail,
        GIT_TERMINAL_PROMPT: '0',
        // Every git process launched by the agent inherits these paths. The worktree stays
        // conventional while mutable metadata avoids Codex's protected `.git` name.
        GIT_DIR: GIT_METADATA_DIR,
        GIT_WORK_TREE: REPO_DIR,
    }
    if (gitContext.provider === 'github') {
        // Let the gh CLI / curl calls authenticate without re-plumbing the token.
        env.GH_TOKEN = gitContext.token
        env.GITHUB_TOKEN = gitContext.token
        env.GH_API = gitContext.apiBase || 'https://api.github.com'
        env.GH_REPO = gitContext.repoSlug || ''
        if (gitContext.apiBase && gitContext.apiBase !== 'https://api.github.com') {
            env.GH_HOST = gitContext.apiBase.replace(/^https?:\/\//, '').replace(/\/api\/v3$/, '')
        }
    }
    return env
}

// Clone (or refresh, on resume) the repo and configure git auth before the agent runs.
// Throws a user-facing error on failure so the job fails+refunds instead of running blind.
async function setupGitRepo(sandbox, gitContext, correlationId) {
    await sandbox.files.write('/home/user/git-setup.sh', GIT_SETUP_SCRIPT)
    let stderr = ''
    let stdout = ''
    try {
        await sandbox.commands.run('bash /home/user/git-setup.sh', {
            envs: buildGitEnv(gitContext),
            timeoutMs: 5 * 60 * 1000,
            onStdout: d => {
                stdout += d
            },
            onStderr: d => {
                stderr += d
            },
        })
    } catch (err) {
        // git error text won't contain the token (the credential helper output is not echoed).
        const detail = (stderr || err.message || '').substring(0, 300)
        throw new Error(`Could not prepare the connected GitLab repository. ${detail}`)
    }
    console.log('🖥️ VM JOB: git repo ready', {
        correlationId,
        head: ((stdout || '').match(/GIT_SETUP_OK (\S+)/) || [])[1] || null,
    })
}

// Read the requesting user's connected Google Cloud project (if any) and mint a short-lived,
// read-only access token for this run. Best-effort: any failure just means the task runs without
// GCP access (it never blocks the job). Applies to every task type, not just coding. The token
// (~1h TTL) is minted fresh each run and injected per-command via envs — it is never written to
// disk or captured in the paused-session snapshot, exactly like the git token.
async function loadGcpContext(vmJob) {
    try {
        const userId = vmJob.requestUserId
        if (!userId || !vmJob.projectId) return null
        const snap = await admin.firestore().doc(`users/${userId}/private/gcpAuth_${vmJob.projectId}`).get()
        if (!snap.exists) return null
        const data = snap.data() || {}
        if (!data.serviceAccountKey) return null
        const { mintGcpAccessToken, parseServiceAccountKey } = require('../Gcp/gcpConnect')
        const sa = parseServiceAccountKey(data.serviceAccountKey)
        const { accessToken, expiresAtMs } = await mintGcpAccessToken(sa)
        snap.ref.set({ lastUsed: Date.now() }, { merge: true }).catch(() => {})
        return {
            enabled: true,
            gcpProjectId: data.gcpProjectId || sa.project_id || '',
            accessToken,
            expiresAtMs,
            capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: failed loading GCP context', {
            correlationId: vmJob.correlationId,
            error: error.message,
        })
        return null
    }
}

// The per-command env carrying the short-lived read-only GCP token into the sandbox. Standard
// names so both raw curl (referenced in the prompt) and the gcloud CLI (if present) pick it up.
function buildGcpEnv(gcpContext) {
    return {
        GCP_ACCESS_TOKEN: gcpContext.accessToken,
        CLOUDSDK_AUTH_ACCESS_TOKEN: gcpContext.accessToken,
        GOOGLE_CLOUD_PROJECT: gcpContext.gcpProjectId,
        CLOUDSDK_CORE_PROJECT: gcpContext.gcpProjectId,
    }
}

/**
 * Update the single live status comment in place (created when the job started).
 * Falls back to creating a new comment if no commentId was recorded.
 */
async function writeStatusComment(
    pendingWebhook,
    text,
    { isFinal = false, output = null, mediaContext = null, assistantRunStatus = null } = {}
) {
    const { projectId, objectType = 'tasks', objectId, assistantId, statusCommentId } = pendingWebhook
    const db = admin.firestore()
    const commentPathBase = `chatComments/${projectId}/${objectType}/${objectId}/comments`

    const commentId = statusCommentId || Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
    const runStatus = assistantRunStatus || (isFinal ? 'completed' : 'running')
    const runIsActive = runStatus === 'running' || runStatus === VM_JOB_CANCEL_REQUESTED_STATUS
    const commentPayload = {
        creatorId: assistantId,
        commentText: text,
        originalContent: text,
        commentType: 'STAYWARD_COMMENT',
        lastChangeDate: admin.firestore.Timestamp.now(),
        fromAssistant: true,
        isLoading: runIsActive,
        isThinking: false,
        assistantRun: {
            kind: 'vm_job',
            runId: pendingWebhook.correlationId,
            requestUserId: pendingWebhook.userId,
            status: runStatus,
        },
    }
    if (runStatus === VM_JOB_CANCELLED_STATUS) commentPayload.assistantRun.cancelledAt = Date.now()
    if (runStatus === 'failed') commentPayload.assistantRun.failedAt = Date.now()
    if (runStatus === 'completed') commentPayload.assistantRun.completedAt = Date.now()
    if (Array.isArray(mediaContext) && mediaContext.length) {
        commentPayload.mediaContext = mediaContext
    }
    if (isFinal && output != null) {
        commentPayload.webhookData = { output, correlationId: pendingWebhook.correlationId, kind: 'vm_job' }
        // The live VM status comment is created before the assistant's "started" reply.
        // When it becomes the final answer, move it to completion time so chronological
        // chat views show: user request -> VM started confirmation -> VM result.
        commentPayload.created = Date.now()
    }

    try {
        if (statusCommentId) {
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload, { merge: true })
        } else {
            commentPayload.created = Date.now()
            await db.doc(`${commentPathBase}/${commentId}`).set(commentPayload)
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed writing status comment', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
        return
    }

    // Keep the chat object / parent object comment preview in sync and emit the
    // same unread/notification metadata as a normal assistant message. A failed or
    // cancelled run is also a settled result that users should see in the task list.
    // The idempotency marker on the comment prevents retries from incrementing twice.
    const isSettled = isFinal || runStatus === 'failed' || runStatus === VM_JOB_CANCELLED_STATUS
    if (isSettled) {
        try {
            await applyVmCompletionMetadata(pendingWebhook, commentId, text)
        } catch (error) {
            console.warn('🖥️ VM JOB: Failed applying completion metadata', {
                correlationId: pendingWebhook.correlationId,
                error: error.message,
            })
        }
    }
}

/**
 * Build the prompt fed to Claude Code inside the sandbox.
 */
function buildAgentPrompt(vmJob, gitContext = null, gcpContext = null) {
    const profile = TASK_TYPE_PROFILES[vmJob.taskType] || TASK_TYPE_PROFILES.research
    const parts = [profile, '', `# Objective`, vmJob.objective]
    if (vmJob.deliverable) {
        parts.push('', `# Expected deliverable`, vmJob.deliverable)
    }
    if (vmJob.packagedContext) {
        parts.push(
            '',
            `# Background context (provided from the app — also written to /home/user/context.md)`,
            vmJob.packagedContext
        )
    }
    if (vmJob.threadContext) {
        parts.push(
            '',
            '# Originating chat thread context (also written to /home/user/context.md)',
            'Context from the Alldone chat thread this task was created in — who the user is, the project, ' +
                'your assistant persona, the conversation so far, files shared in the thread, and the ' +
                "user's date/time and language. Use it to ground your work and match the intent and language " +
                'already established; do not ask for details already provided here.',
            vmJob.threadContext
        )
    }
    if (gitContext && gitContext.enabled) {
        const base = gitContext.baseBranch
        const isGithub = gitContext.provider === 'github'
        const providerName = isGithub ? 'GitHub' : 'GitLab'
        const reqName = isGithub ? 'Pull Request' : 'Merge Request'
        parts.push(
            '',
            '# Connected Git repository',
            `You are working inside a Git checkout of the project's connected ${providerName} repository at ${REPO_DIR} ` +
                `(already cloned and authenticated, with the base branch "${base}" checked out). This is your working directory — make your code changes there.`,
            `Only deliver the work as a ${providerName} ${reqName} when you actually changed repository files. Do NOT push to the base branch directly:`,
            `1. Create a new branch off "${base}": git checkout -b ai/<short-descriptive-slug>`,
            '2. Make your edits.',
            '3. Before committing, run git status --short and/or git diff --quiet. If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request; just explain the answer or why no code change was needed in your final message.',
            '4. If there are actual repository changes, commit them with clear, conventional commit messages.',
            "Repository dependencies are intentionally NOT installed before you start. Install them with the repository's package manager only when the requested change or a necessary lint/test/build verification actually requires them. For explanation-only work or when no code change is needed, do not install dependencies."
        )
        if (isGithub) {
            parts.push(
                '5. Push the branch: git push -u origin HEAD',
                `6. Open the Pull Request with the GitHub CLI (already authenticated via $GH_TOKEN): gh pr create --base ${base} --head <your-branch> --title "<concise title>" --body "<summary of the change>"`,
                '   The gh command prints the Pull Request URL. If gh is not installed, instead POST to the GitHub REST API with curl: ' +
                    `curl -sS -X POST "$GH_API/repos/$GH_REPO/pulls" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -d '{"title":"<title>","head":"<your-branch>","base":"${base}","body":"<summary>"}'  (read the "html_url" field from the JSON response).`,
                '7. Copy the Pull Request URL into your final message so the user can review it.'
            )
        } else {
            parts.push(
                '5. Push the branch AND open the Merge Request in a single command:',
                `   git push -u origin HEAD -o merge_request.create -o merge_request.target=${base} -o merge_request.title="<concise title>" -o merge_request.remove_source_branch`,
                '6. GitLab prints the Merge Request URL on stderr right after the push — copy that URL into your final message so the user can review it.'
            )
        }
        parts.push(
            'If git push, gh pr create, or the REST API call fails with a transient network or DNS error, wait briefly and retry before reporting failure.',
            'Authentication is already configured via a git credential helper. Do NOT change git remotes, credentials, or config, and never print, echo, or commit any tokens. ' +
                `If a direct push to the base branch is rejected because it is protected, that is expected — open a ${reqName} instead.`,
            `If you made repository changes, your final message MUST include the ${reqName} URL (or, if you genuinely could not open one, a clear explanation of why). If you made no repository changes, your final message MUST say that no ${reqName} was opened because no code change was needed.`
        )
    }
    if (gcpContext && gcpContext.enabled) {
        const caps = []
        if (gcpContext.capabilities.includes('firestore.read')) caps.push('Firestore (documents & queries)')
        if (gcpContext.capabilities.includes('logging.read'))
            caps.push('Cloud Logging (e.g. Cloud Functions / Cloud Run logs)')
        parts.push(
            '',
            '# Connected Google Cloud project (read-only)',
            `You have READ-ONLY access to the user's Google Cloud project "${gcpContext.gcpProjectId}"${
                caps.length ? ` — available: ${caps.join('; ')}` : ''
            }. A short-lived read-only access token is in the environment as $GCP_ACCESS_TOKEN (also exported as ` +
                '$CLOUDSDK_AUTH_ACCESS_TOKEN for the gcloud CLI), and the project id as $GOOGLE_CLOUD_PROJECT.',
            'The token is read-only and expires shortly after this task. NEVER print, echo, log, or persist it. ' +
                'Only read what the task actually needs; any write/delete call will fail by design.',
            'Prefer the REST APIs with curl (gcloud may not be installed in this sandbox):',
            '- Read one Firestore document:',
            '    curl -sS "https://firestore.googleapis.com/v1/projects/$GOOGLE_CLOUD_PROJECT/databases/(default)/documents/<collection>/<docId>" -H "Authorization: Bearer $GCP_ACCESS_TOKEN"',
            '- List / page a Firestore collection (nested paths use collection/doc/collection, e.g. goldStats/daily/days):',
            '    curl -sS "https://firestore.googleapis.com/v1/projects/$GOOGLE_CLOUD_PROJECT/databases/(default)/documents/<collectionPath>?pageSize=100" -H "Authorization: Bearer $GCP_ACCESS_TOKEN"',
            '- Structured query: POST to ".../documents:runQuery" with the same Authorization header and a JSON body ' +
                'like {"structuredQuery":{"from":[{"collectionId":"<collection>"}],"limit":50}}.',
            '- Read recent logs: POST to "https://logging.googleapis.com/v2/entries:list" with the same Authorization ' +
                'header and a JSON body like {"resourceNames":["projects/$GOOGLE_CLOUD_PROJECT"],"filter":"resource.type=\\"cloud_run_revision\\"","orderBy":"timestamp desc","pageSize":50} ' +
                '(resource.type="cloud_run_revision" targets 2nd-gen Cloud Functions / Cloud Run; substitute the real project id for $GOOGLE_CLOUD_PROJECT inside the JSON).'
        )
    }
    parts.push(
        '',
        'Work autonomously to completion. Your final message will be delivered verbatim to the user as the result, so make it a complete, self-contained answer.',
        'IMPORTANT: Do not create an output file just to return a normal text/chat answer. Put the answer directly in your final message unless the user asked for a file or you genuinely produced an artifact.',
        'If you produce any deliverable files (documents, HTML, spreadsheets, images, datasets, etc.) that are NOT part of the repository, SAVE them into the /home/user/output/ directory (an absolute path). Every file there is uploaded back to the user and attached to your result in the chat. Do not paste large file contents into your final message — put them in /home/user/output/ instead.'
    )
    return parts.join('\n')
}

// --- Generated-file (artifact) return ---

const ARTIFACT_DIR = '/home/user/output'
const MAX_ARTIFACTS = 10
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024 // 20 MB per file
const MAX_ARTIFACTS_TOTAL_BYTES = 40 * 1024 * 1024 // 40 MB total

// Chat attachment token — mirrors ATTACHMENT_TRIGGER in components/Feeds/Utils/HelperFunctions.js.
// Embedding `${T}{url}${T}{name}${T}false` as a space-delimited word in the comment text makes the
// chat render an inline, downloadable FileDownloadableTag. (The mediaContext array alone does NOT
// produce the inline download; without a token a bare filename gets auto-linkified to a bogus URL.)
const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'

// Build the space-delimited attachment tokens for the comment text from uploaded files.
function buildAttachmentTokens(mediaContext) {
    return mediaContext
        .map(m => {
            const name = (m.fileName || 'file').replace(/\s+/g, '_') // tokens must be whitespace-free
            return `${ATTACHMENT_TRIGGER}${m.storageUrl}${ATTACHMENT_TRIGGER}${name}${ATTACHMENT_TRIGGER}false`
        })
        .join(' ')
}

function buildVmFinalCommentText(output, mediaContext) {
    const message = String(output || '').trim()
    if (!Array.isArray(mediaContext) || !mediaContext.length) return message

    return `${buildAttachmentTokens(mediaContext)}\n\n${message}`
}

const MIME_BY_EXT = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
}

function mimeForFile(name) {
    const ext = (name.split('.').pop() || '').toLowerCase()
    return MIME_BY_EXT[ext] || 'application/octet-stream'
}

// Pull deliverable files the agent wrote to /home/user/output out of the sandbox.
// Best-effort: returns [] on any failure so a file hiccup never fails the whole job.
async function collectArtifacts(sandbox, correlationId, sinceMs = 0) {
    try {
        let entries
        try {
            entries = await sandbox.files.list(ARTIFACT_DIR, { depth: 5 })
        } catch (_) {
            return [] // dir missing / empty
        }
        // On a resumed session, only collect files written/modified during THIS run, so we
        // don't re-attach deliverables from previous runs that are still in /home/user/output.
        const skewMs = 5000
        const files = (entries || []).filter(e => {
            if (!((e.type === 'file' || e.type === undefined) && e.size > 0)) return false
            if (!sinceMs) return true
            const mt = e.modifiedTime ? new Date(e.modifiedTime).getTime() : 0
            return mt === 0 || mt >= sinceMs - skewMs
        })
        const artifacts = []
        let totalBytes = 0
        for (const entry of files) {
            if (artifacts.length >= MAX_ARTIFACTS) break
            if (entry.size > MAX_ARTIFACT_BYTES) {
                console.warn('🖥️ VM JOB: skipping oversized artifact', {
                    correlationId,
                    name: entry.name,
                    size: entry.size,
                })
                continue
            }
            if (totalBytes + entry.size > MAX_ARTIFACTS_TOTAL_BYTES) break
            try {
                const data = await sandbox.files.read(entry.path, { format: 'bytes' })
                const buffer = Buffer.from(data)
                totalBytes += buffer.length
                artifacts.push({ fileName: entry.name, mimeType: mimeForFile(entry.name), bytes: buffer })
            } catch (error) {
                console.warn('🖥️ VM JOB: failed reading artifact', {
                    correlationId,
                    name: entry.name,
                    error: error.message,
                })
            }
        }
        if (artifacts.length) {
            console.log('🖥️ VM JOB: collected artifacts', {
                correlationId,
                count: artifacts.length,
                names: artifacts.map(a => a.fileName),
            })
        }
        return artifacts
    } catch (error) {
        console.warn('🖥️ VM JOB: collectArtifacts failed', { correlationId, error: error.message })
        return []
    }
}

// --- Live activity feed from agent stream events ---

const MAX_ACTIVITY_LINES = 15

// Tool metadata can contain very large implementation details (for example a full patch in a
// shell command), so keep those labels compact. Provider-authored progress text is handled
// separately and must remain verbatim so the chat never silently cuts an agent update short.
function summarizeToolDetail(value, n) {
    const s = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return s.length > n ? s.substring(0, n) + '…' : s
}

function formatActivityText(value) {
    return String(value || '').trim()
}

// Map a Claude Code tool_use block to a friendly, human-readable activity line.
function claudeToolLabel(name, input) {
    const i = input || {}
    switch (name) {
        case 'WebSearch':
            return `🔍 Searching the web${i.query ? `: "${summarizeToolDetail(i.query, 80)}"` : '…'}`
        case 'WebFetch':
            return `🌐 Reading ${summarizeToolDetail(i.url || '', 80)}`
        case 'Bash':
            return `💻 ${summarizeToolDetail(i.command || 'running a command', 100)}`
        case 'Read':
            return `📄 Reading ${summarizeToolDetail(i.file_path || i.path || '', 80)}`
        case 'Write':
            return `✍️ Writing ${summarizeToolDetail(i.file_path || i.path || '', 80)}`
        case 'Edit':
        case 'MultiEdit':
            return `✏️ Editing ${summarizeToolDetail(i.file_path || i.path || '', 80)}`
        case 'Glob':
        case 'Grep':
            return `🔎 Searching files${i.pattern ? `: ${summarizeToolDetail(i.pattern, 60)}` : '…'}`
        case 'TodoWrite':
            return '🗒️ Planning the work…'
        default:
            return `🔧 ${name || 'tool'}`
    }
}

// Claude Code stream-json event → mutate state { activity[], finalResult, assistantText }.
// Final answer comes from the terminal `result` event.
function appendClaudeActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'result') {
        if (typeof evt.result === 'string') state.finalResult = evt.result
        if (evt.usage) {
            const u = evt.usage
            const cache = (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
            const input = u.input_tokens || 0
            const output = u.output_tokens || 0
            state.usage = {
                inputTokens: input,
                outputTokens: output,
                cacheTokens: cache,
                totalTokens: input + output + cache,
                costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : null,
            }
        }
        return
    }
    if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
        for (const b of evt.message.content) {
            if (b && b.type === 'text' && b.text) {
                state.assistantText += b.text
                const activityText = formatActivityText(b.text)
                if (activityText) state.activity.push(`💬 ${activityText}`)
            } else if (b && b.type === 'tool_use') {
                state.activity.push(claudeToolLabel(b.name, b.input))
            }
        }
    }
}

// OpenAI Codex `exec --json` event → mutate state. There is no `result` event; the
// final answer is the last `agent_message` item's text.
function appendCodexActivity(evt, state) {
    if (!evt || typeof evt !== 'object') return
    if (evt.type === 'error') {
        state.activity.push(`⚠️ ${formatActivityText(evt.message || evt.error || 'error')}`)
        return
    }
    if (evt.type === 'turn.completed') {
        const u = evt.usage || {}
        const input = u.input_tokens || 0
        const output = u.output_tokens || 0
        const cache = u.cached_input_tokens || 0
        state.usage = {
            inputTokens: input,
            outputTokens: output,
            cacheTokens: cache,
            totalTokens: u.total_tokens || input + output + cache,
            costUsd: null,
        }
        return
    }
    const item = evt.item
    if (!item || typeof item !== 'object') return
    const completed = evt.type === 'item.completed' || evt.type === 'item.done'
    switch (item.type) {
        case 'agent_message':
            if (typeof item.text === 'string' && item.text) {
                state.assistantText = item.text // last agent message is the final answer
                const activityText = formatActivityText(item.text)
                if (completed && activityText) state.activity.push(`💬 ${activityText}`)
            }
            break
        case 'reasoning':
            if (completed && item.text) state.activity.push(`💭 ${formatActivityText(item.text)}`)
            break
        case 'command_execution':
            if (completed) state.activity.push(`💻 ${summarizeToolDetail(item.command || 'command', 100)}`)
            break
        case 'web_search':
            if (completed)
                state.activity.push(`🔍 Searching${item.query ? `: "${summarizeToolDetail(item.query, 80)}"` : '…'}`)
            break
        case 'file_change':
            if (completed) state.activity.push('✏️ Editing files')
            break
        case 'mcp_tool_call':
            if (completed) state.activity.push(`🔧 ${summarizeToolDetail(item.tool || item.name || 'tool', 60)}`)
            break
        case 'todo_list':
        case 'plan_update':
            if (completed) state.activity.push('🗒️ Planning the work…')
            break
        default:
            break
    }
}

// Resolve the model + effort the agent will actually run with, applying the same per-agent
// defaults the worker uses to build the CLI command. Kept here so the status header shows the
// real values even when the assistant omitted agentModel / agentReasoningEffort on the tool call.
function resolveAgentRunDetails(vmJob) {
    const agent = (vmJob && vmJob.agent) || DEFAULT_AGENT
    const model = (vmJob && vmJob.agentModel) || (agent === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL)
    const effort =
        (vmJob && vmJob.agentReasoningEffort) ||
        (agent === 'codex' ? DEFAULT_CODEX_REASONING_EFFORT : DEFAULT_CLAUDE_EFFORT_LEVEL)
    return { model, effort }
}

function renderVmWorkingHeader(agentLabel, runDetails, credentialMode) {
    const suffix = runDetails ? formatAgentRunSuffix(runDetails.model, runDetails.effort) : ''
    const header = `🖥️ Working with ${agentLabel}${suffix} in a VM…`
    return credentialMode !== undefined ? `${header}\n\n${formatVmBillingStatus(agentLabel, credentialMode)}` : header
}

function renderActivityLog(lines, agentLabel, runDetails, credentialMode) {
    return `${renderVmWorkingHeader(agentLabel, runDetails, credentialMode)}\n\n${lines
        .slice(-MAX_ACTIVITY_LINES)
        .join('\n')}`
}

// Per-agent configuration. The assistant picks the agent per task; we map it to the
// matching E2B prebuilt template, API key, sandbox env, headless command, and parser.
// E2B_*_TEMPLATE env vars are optional overrides — they default to E2B's prebuilt names.
function buildClaudeRunCommand(isResume, agentModel, agentReasoningEffort) {
    const resumeFlag = isResume ? '--continue ' : ''
    const modelFlag = agentModel ? `--model ${agentModel} ` : ''
    const effortFlag = agentReasoningEffort ? `--effort ${agentReasoningEffort} ` : ''
    return `claude ${resumeFlag}${modelFlag}${effortFlag}-p "$(cat /home/user/prompt.txt)" --output-format stream-json --verbose --dangerously-skip-permissions </dev/null`
}

const CODEX_VM_PROXY_PROVIDER = 'alldone_vm_proxy'

function shellQuoteArg(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function buildCodexProxyConfigOverrides(proxyBaseUrl) {
    let parsed
    try {
        parsed = new URL(proxyBaseUrl)
    } catch (_) {
        throw new Error('Codex VM proxy base URL is invalid.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Codex VM proxy base URL must use HTTP or HTTPS.')
    }
    if (parsed.search || parsed.hash) {
        throw new Error('Codex VM proxy base URL must not contain a query string or fragment.')
    }

    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/openai/v1`
    const openAiProxyBaseUrl = parsed.toString().replace(/\/$/, '')

    // Codex's built-in OpenAI provider may use the Responses WebSocket transport. Our
    // Cloud Function proxy is HTTP-only, so use an explicit custom provider and disable
    // WebSockets instead of relying on the legacy OPENAI_BASE_URL environment override.
    return [
        `model_provider=${JSON.stringify(CODEX_VM_PROXY_PROVIDER)}`,
        `model_providers.${CODEX_VM_PROXY_PROVIDER}.name=${JSON.stringify('Alldone VM LLM proxy')}`,
        `model_providers.${CODEX_VM_PROXY_PROVIDER}.base_url=${JSON.stringify(openAiProxyBaseUrl)}`,
        `model_providers.${CODEX_VM_PROXY_PROVIDER}.env_key=${JSON.stringify('OPENAI_API_KEY')}`,
        `model_providers.${CODEX_VM_PROXY_PROVIDER}.wire_api=${JSON.stringify('responses')}`,
        `model_providers.${CODEX_VM_PROXY_PROVIDER}.supports_websockets=false`,
    ]
}

function buildCodexRunCommand(isResume, agentModel, agentReasoningEffort, proxyBaseUrl, subscriptionUsed = false) {
    const resumePart = isResume ? 'exec resume --last' : 'exec'
    const modelFlag = agentModel ? ` --model ${agentModel}` : ''
    const effortFlag = agentReasoningEffort ? ` -c model_reasoning_effort=${agentReasoningEffort}` : ''
    const sandboxFlag = ` -c ${shellQuoteArg('sandbox_mode="workspace-write"')}`
    const gitMetadataFlag = ` -c ${shellQuoteArg(
        `sandbox_workspace_write.writable_roots=[${JSON.stringify(GIT_METADATA_ROOT)}]`
    )}`
    const providerFlags = subscriptionUsed
        ? ''
        : buildCodexProxyConfigOverrides(proxyBaseUrl)
              .map(override => ` -c ${shellQuoteArg(override)}`)
              .join('')
    return `codex ${resumePart}${sandboxFlag}${gitMetadataFlag} -c sandbox_workspace_write.network_access=true --skip-git-repo-check${modelFlag}${effortFlag}${providerFlags} --json "$(cat /home/user/prompt.txt)" </dev/null`
}

function buildLatestAgentCliInstallCommand(packageName, binaryName, options = {}) {
    const prefix = options.prefix || AGENT_CLI_NPM_PREFIX
    const binaryPath = `${prefix}/bin/${binaryName}`
    const lockPath = options.lockPath || `/tmp/alldone-${binaryName}-cli-install.lock`

    // Managed E2B templates can already contain a CLI launcher at the same path npm uses
    // for its global link. Check the working CLI first, then move only that known launcher
    // out of npm's way for an actual install/upgrade. The lock makes this safe when two
    // initializations briefly target the same resumed sandbox.
    return [
        `export PATH=${shellQuoteArg(`${prefix}/bin`)}:$PATH`,
        `cli_prefix=${shellQuoteArg(prefix)}`,
        `binary_name=${shellQuoteArg(binaryName)}`,
        `binary_path=${shellQuoteArg(binaryPath)}`,
        `package_name=${shellQuoteArg(packageName)}`,
        `lock_path=${shellQuoteArg(lockPath)}`,
        `command -v flock >/dev/null 2>&1 || { printf 'Agent CLI bootstrap requires flock.\\n' >&2; exit 1; }`,
        `mkdir -p "$cli_prefix/bin"`,
        `exec 9>"$lock_path"`,
        `flock -w 300 9 || { printf 'Timed out waiting for the agent CLI installation lock.\\n' >&2; exit 1; }`,
        `latest_version="$(npm view "$package_name" version --silent)"`,
        `npm_view_status=$?`,
        `if [ "$npm_view_status" -ne 0 ]; then exit "$npm_view_status"; fi`,
        `[ -n "$latest_version" ] || { printf 'npm returned no latest version for %s.\\n' "$package_name" >&2; exit 1; }`,
        `active_binary="$(command -v "$binary_name" 2>/dev/null || true)"`,
        `installed_output=''`,
        `installed_version=''`,
        `if [ -n "$active_binary" ] && installed_output="$("$active_binary" --version 2>/dev/null)"; then`,
        `    installed_version="$(printf '%s\\n' "$installed_output" | sed -n 's/^[^0-9]*\\([0-9][0-9]*\\.[0-9][0-9]*\\.[0-9][0-9]*[-+A-Za-z0-9.]*\\).*/\\1/p' | head -n 1)"`,
        `fi`,
        `if [ "$installed_version" = "$latest_version" ]; then`,
        `    printf 'AGENT_CLI_READY existing %s\\n' "$installed_version"`,
        `    exit 0`,
        `fi`,
        `printf 'AGENT_CLI_INSTALLING from=%s to=%s\\n' "\${installed_version:-missing-or-invalid}" "$latest_version"`,
        `backup_path=''`,
        `if [ -e "$binary_path" ] || [ -L "$binary_path" ]; then`,
        `    if [ -d "$binary_path" ] && [ ! -L "$binary_path" ]; then`,
        `        printf 'Refusing to replace directory at agent CLI path: %s\\n' "$binary_path" >&2`,
        `        exit 1`,
        `    fi`,
        `    backup_path="\${binary_path}.alldone-backup.$$"`,
        `    mv -- "$binary_path" "$backup_path"`,
        `fi`,
        `npm install -g --prefix "$cli_prefix" "$package_name@$latest_version"`,
        `npm_status=$?`,
        `if [ "$npm_status" -ne 0 ]; then`,
        `    if [ -e "$binary_path" ] || [ -L "$binary_path" ]; then rm -f -- "$binary_path"; fi`,
        `    if [ -n "$backup_path" ]; then mv -- "$backup_path" "$binary_path"; fi`,
        `    exit "$npm_status"`,
        `fi`,
        `installed_output="$("$binary_path" --version 2>/dev/null || true)"`,
        `installed_version="$(printf '%s\\n' "$installed_output" | sed -n 's/^[^0-9]*\\([0-9][0-9]*\\.[0-9][0-9]*\\.[0-9][0-9]*[-+A-Za-z0-9.]*\\).*/\\1/p' | head -n 1)"`,
        `if [ "$installed_version" != "$latest_version" ]; then`,
        `    printf 'Installed %s CLI failed validation (expected %s, got %s).\\n' "$binary_name" "$latest_version" "\${installed_version:-unreadable}" >&2`,
        `    if [ -e "$binary_path" ] || [ -L "$binary_path" ]; then rm -f -- "$binary_path"; fi`,
        `    if [ -n "$backup_path" ]; then mv -- "$backup_path" "$binary_path"; fi`,
        `    exit 1`,
        `fi`,
        `if [ -n "$backup_path" ]; then rm -f -- "$backup_path"; fi`,
        `printf 'AGENT_CLI_READY installed %s\\n' "$installed_version"`,
    ].join('\n')
}

function buildClaudeInstallGuard(options) {
    return buildLatestAgentCliInstallCommand('@anthropic-ai/claude-code', 'claude', options)
}

function buildCodexInstallGuard(options) {
    return buildLatestAgentCliInstallCommand('@openai/codex', 'codex', options)
}

function sanitizeVmErrorText(value, maxLength = 1200) {
    const sanitized = String(value || '')
        .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-ant-|sk-|glpat-|ghp_|github_pat_|npm_|ya29\.)[A-Za-z0-9_.-]+/gi, '[REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
        .replace(/([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)\s*=\s*)[^\s]+/g, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/\s+/g, ' ')
        .trim()
    return sanitized.length > maxLength ? `${sanitized.substring(0, maxLength)}…` : sanitized
}

function buildStageError(stage, error, stdout = '', stderr = '') {
    const cleanStdout = String(stdout || '')
        .replace(/^AGENT_CLI_(?:INSTALLING|READY)[^\n]*\s*$/gm, '')
        .trim()
    const diagnostics = [cleanStdout ? `stdout: ${cleanStdout}` : '', stderr ? `stderr: ${stderr}` : '']
        .filter(Boolean)
        .join('\n')
    const detail = sanitizeVmErrorText(diagnostics || error?.message || '')
    return new Error(`${stage} failed.${detail ? ` ${detail}` : ''}`)
}

function buildAgentExitError(agentLabel, result, state, stderr = '', fallbackError = null) {
    const exitCode = result?.exitCode ?? fallbackError?.exitCode ?? fallbackError?.code
    const output = (state?.finalResult || state?.assistantText || '').trim()
    const detail = sanitizeVmErrorText([output, stderr, fallbackError?.message].filter(Boolean).join('\n'))
    const status = exitCode !== undefined && exitCode !== null ? ` with exit status ${exitCode}` : ''
    return new Error(`${agentLabel} exited${status}.${detail ? ` ${detail}` : ''}`)
}

async function ensureAgentCliAvailable(sandbox, config, agentLabel, onActivity, header) {
    const command = typeof config.installGuard === 'function' ? config.installGuard() : config.installGuard
    if (!command) return

    let stdout = ''
    let stderr = ''
    let installationAnnounced = false
    const appendDiagnostic = (current, data) => `${current}${data}`.slice(-MAX_BOOTSTRAP_DIAGNOSTIC_CHARS)
    const handleStdout = data => {
        if (!installationAnnounced && String(data).includes('AGENT_CLI_INSTALLING')) {
            installationAnnounced = true
            if (typeof onActivity === 'function') onActivity(`${header}\n\n📦 Installing ${agentLabel}…`)
        }
        stdout = appendDiagnostic(stdout, data)
    }

    console.log('🖥️ VM JOB: updating agent CLI', { agent: agentLabel, version: 'latest' })
    try {
        await sandbox.commands.run(`bash -lc '${command.replace(/'/g, `'\\''`)}'`, {
            envs: buildSandboxCommandEnv(),
            timeoutMs: 5 * 60 * 1000,
            onStdout: handleStdout,
            onStderr: data => {
                stderr = appendDiagnostic(stderr, data)
            },
        })
    } catch (error) {
        const stage = installationAnnounced ? `${agentLabel} installation` : `${agentLabel} bootstrap`
        const stageError = buildStageError(stage, error, stdout, stderr)
        console.error('🖥️ VM JOB: agent CLI bootstrap failed', {
            agent: agentLabel,
            stage,
            error: stageError.message,
        })
        throw stageError
    }
    console.log('🖥️ VM JOB: agent CLI ready', {
        agent: agentLabel,
        version: 'latest',
    })
}

const AGENT_CONFIGS = {
    claude: {
        label: 'Claude Code',
        displayName: 'Claude',
        defaultTemplate: 'claude',
        apiKeyField: 'ANTHROPIC_API_KEY',
        installGuard: buildClaudeInstallGuard,
        // On resume, `--continue` continues the most recent session in the working dir.
        buildRun: (isResume, { agentModel, agentReasoningEffort } = {}) =>
            buildClaudeRunCommand(isResume, agentModel, agentReasoningEffort),
        // `apiKey` is a short-lived per-job proxy token. Claude Code is pointed at the proxy,
        // and the real key stays server-side (see vmLlmProxy.js).
        sandboxEnv: ({ apiKey, baseUrl, mode, credential }) => ({
            ...(mode === 'subscription'
                ? { CLAUDE_CODE_OAUTH_TOKEN: credential }
                : {
                      ANTHROPIC_API_KEY: apiKey,
                      ...(baseUrl ? { ANTHROPIC_BASE_URL: `${baseUrl}/anthropic` } : {}),
                  }),
            CI: 'true',
            DISABLE_AUTOUPDATER: '1',
            DISABLE_TELEMETRY: '1',
            DISABLE_ERROR_REPORTING: '1',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        }),
        handleEvent: appendClaudeActivity,
    },
    codex: {
        label: 'Codex',
        displayName: 'Codex',
        defaultTemplate: 'codex',
        apiKeyField: 'OPEN_AI_KEY', // reuse the existing OpenAI key
        installGuard: buildCodexInstallGuard,
        // On resume, `codex exec resume --last` continues the most recent thread.
        // `codex exec` is already non-interactive (it never prompts for approval), so we do NOT
        // pass `--ask-for-approval` — newer Codex CLIs reject that flag on `exec` (exit status 2:
        // "unexpected argument '--ask-for-approval' found"). Codex has its own command sandbox
        // inside the E2B sandbox; configure sandbox_mode instead of using --sandbox because
        // current `codex exec resume` rejects that flag. Workspace-write still needs explicit
        // network access for package installs, git push, and PR creation.
        buildRun: (isResume, { agentModel, agentReasoningEffort, proxyBaseUrl, subscriptionUsed } = {}) =>
            buildCodexRunCommand(isResume, agentModel, agentReasoningEffort, proxyBaseUrl, subscriptionUsed),
        // `apiKey` is a short-lived per-job proxy token. The run command selects an explicit
        // HTTP-only custom provider; OPENAI_BASE_URL remains for older Codex CLI compatibility.
        sandboxEnv: ({ apiKey, baseUrl, mode }) =>
            mode === 'subscription'
                ? { CODEX_HOME: CODEX_AUTH_DIR, CI: 'true' }
                : {
                      CODEX_API_KEY: apiKey,
                      OPENAI_API_KEY: apiKey,
                      ...(baseUrl ? { OPENAI_BASE_URL: `${baseUrl}/openai/v1` } : {}),
                      CI: 'true',
                  },
        handleEvent: appendCodexActivity,
    },
}

const DEFAULT_AGENT = 'claude'

class VmGoldExhaustedError extends Error {
    constructor(message = VM_GOLD_EXHAUSTED_TEXT, runtimeGoldCharged = 0) {
        super(message)
        this.name = 'VmGoldExhaustedError'
        this.code = VM_GOLD_EXHAUSTED_FAILURE_REASON
        this.runtimeGoldCharged = runtimeGoldCharged
    }
}

function isVmGoldExhaustedError(error) {
    return error && error.code === VM_GOLD_EXHAUSTED_FAILURE_REASON
}

class VmJobCancelledError extends Error {
    constructor(message = VM_JOB_CANCELLED_TEXT, runtimeGoldCharged = 0) {
        super(message)
        this.name = 'VmJobCancelledError'
        this.code = 'vm_job_cancelled'
        this.runtimeGoldCharged = runtimeGoldCharged
    }
}

function isVmJobCancelledError(error) {
    return error && error.code === 'vm_job_cancelled'
}

async function isVmJobCancellationRequested(pendingRef) {
    if (!pendingRef) return false
    try {
        const snap = await pendingRef.get()
        const data = snap.exists ? snap.data() || {} : {}
        return data.status === VM_JOB_CANCEL_REQUESTED_STATUS || data.status === VM_JOB_CANCELLED_STATUS
    } catch (error) {
        console.warn('🖥️ VM JOB: failed checking cancellation', { error: error.message })
        return false
    }
}

async function throwIfVmJobCancelled(pendingRef, runtimeGoldCharged = 0) {
    if (await isVmJobCancellationRequested(pendingRef)) {
        throw new VmJobCancelledError(VM_JOB_CANCELLED_TEXT, runtimeGoldCharged)
    }
}

function calculateAccruedRuntimeGold(runtimeMs) {
    const elapsedMinutes = Math.floor(Math.max(0, Number(runtimeMs) || 0) / 60000)
    return elapsedMinutes * VM_GOLD_PER_MINUTE
}

function calculateCompletionGoldCharges({
    runtimeMs,
    usage,
    runtimeGoldCharged = 0,
    proxyTokenGoldCharged = 0,
    subscriptionUsed = false,
}) {
    const minutes = Math.max(1, Math.ceil(Math.max(0, Number(runtimeMs) || 0) / 60000))
    const totalTokens = usage && usage.totalTokens ? usage.totalTokens : 0
    const runtimeGoldTotal = minutes * VM_GOLD_PER_MINUTE
    const runtimeGoldRemaining = Math.max(0, runtimeGoldTotal - (Number(runtimeGoldCharged) || 0))
    const tokenGoldTotal = subscriptionUsed ? 0 : Math.round(totalTokens / VM_TOKENS_PER_GOLD)
    const tokenGold = Math.max(0, tokenGoldTotal - (Number(proxyTokenGoldCharged) || 0))
    return {
        minutes,
        totalTokens,
        runtimeGoldTotal,
        runtimeGoldRemaining,
        runtimeGoldCharged: Number(runtimeGoldCharged) || 0,
        proxyTokenGoldCharged: Number(proxyTokenGoldCharged) || 0,
        subscriptionUsed: !!subscriptionUsed,
        tokenGoldTotal,
        tokenGold,
        topup: runtimeGoldRemaining + tokenGold,
    }
}

async function getUserGoldBalance(userId) {
    try {
        const snap = await admin.firestore().doc(`users/${userId}`).get()
        if (!snap.exists) return 0
        return Number(snap.data()?.gold) || 0
    } catch (error) {
        console.warn('🖥️ VM JOB: failed reading user Gold balance', { userId, error: error.message })
        throw error
    }
}

function buildVmGoldContext(pendingWebhook, vmJob, note) {
    return {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType,
        note: note || `VM ${vmJob.agent || 'claude'} runtime`,
    }
}

async function killCommandForGold(commandHandle, runtimeGoldCharged) {
    const error = new VmGoldExhaustedError(VM_GOLD_EXHAUSTED_TEXT, runtimeGoldCharged)
    if (commandHandle && typeof commandHandle.kill === 'function') {
        commandHandle.kill().catch(killError => {
            console.warn('🖥️ VM JOB: failed killing command after Gold exhaustion', { error: killError.message })
        })
    }
    throw error
}

async function checkAndChargeVmRuntimeGold({
    pendingWebhook,
    pendingRef,
    commandHandle,
    runStartMs,
    runtimeGoldCharged = 0,
    vmJob,
    now = Date.now,
    getCurrentGold = getUserGoldBalance,
    deductGoldFn = null,
}) {
    const currentGold = await getCurrentGold(pendingWebhook.userId)
    if (currentGold <= 0) {
        console.warn('🖥️ VM JOB: runtime Gold monitor found empty balance', {
            correlationId: pendingWebhook.correlationId,
            userId: pendingWebhook.userId,
            runtimeGoldCharged,
        })
        await killCommandForGold(commandHandle, runtimeGoldCharged)
    }

    const accruedGold = calculateAccruedRuntimeGold(now() - runStartMs)
    const chargeDue = Math.max(0, accruedGold - runtimeGoldCharged)
    console.log('🖥️ VM JOB: runtime Gold monitor tick', {
        correlationId: pendingWebhook.correlationId,
        userId: pendingWebhook.userId,
        currentGold,
        accruedGold,
        runtimeGoldCharged,
        chargeDue,
    })
    if (chargeDue <= 0) return runtimeGoldCharged

    const amountToCharge = Math.min(chargeDue, currentGold)
    const deductGold = deductGoldFn || require('../Gold/goldHelper').deductGold
    const context = buildVmGoldContext(
        pendingWebhook,
        vmJob,
        `VM ${vmJob.agent || 'claude'} runtime charge (${accruedGold} accrued Gold)`
    )

    let charged = 0
    let balanceAfter = currentGold
    let result
    try {
        result = await deductGold(pendingWebhook.userId, amountToCharge, context)
    } catch (error) {
        error.runtimeGoldCharged = runtimeGoldCharged
        throw error
    }
    if (result && result.success) {
        charged = Number(result.amount) || amountToCharge
        balanceAfter = typeof result.newBalance === 'number' ? result.newBalance : currentGold - charged
    } else if (result && typeof result.currentGold === 'number' && result.currentGold > 0) {
        const fallbackAmount = Math.min(chargeDue, result.currentGold)
        let fallback
        try {
            fallback = await deductGold(pendingWebhook.userId, fallbackAmount, context)
        } catch (error) {
            error.runtimeGoldCharged = runtimeGoldCharged
            throw error
        }
        if (fallback && fallback.success) {
            charged = Number(fallback.amount) || fallbackAmount
            balanceAfter = typeof fallback.newBalance === 'number' ? fallback.newBalance : result.currentGold - charged
        }
    }

    const updatedRuntimeGoldCharged = runtimeGoldCharged + charged
    if (charged > 0 && pendingRef && typeof pendingRef.update === 'function') {
        await pendingRef.update({ runtimeGoldCharged: updatedRuntimeGoldCharged }).catch(() => {})
        console.log('🖥️ VM JOB: runtime Gold charged', {
            correlationId: pendingWebhook.correlationId,
            userId: pendingWebhook.userId,
            charged,
            balanceAfter,
            runtimeGoldCharged: updatedRuntimeGoldCharged,
        })
    }

    if (charged < chargeDue || balanceAfter <= 0) {
        console.warn('🖥️ VM JOB: runtime Gold monitor stopping command', {
            correlationId: pendingWebhook.correlationId,
            userId: pendingWebhook.userId,
            charged,
            chargeDue,
            balanceAfter,
            runtimeGoldCharged: updatedRuntimeGoldCharged,
        })
        await killCommandForGold(commandHandle, updatedRuntimeGoldCharged)
    }

    return updatedRuntimeGoldCharged
}

function startVmRuntimeGoldMonitor({
    pendingWebhook,
    pendingRef,
    commandHandle,
    runStartMs,
    vmJob,
    initialRuntimeGoldCharged = 0,
    intervalMs = VM_GOLD_MONITOR_INTERVAL_MS,
}) {
    let runtimeGoldCharged = Number(initialRuntimeGoldCharged) || 0
    let stopped = false
    let checking = false
    let timer = null
    let rejectMonitor
    const promise = new Promise((_, reject) => {
        rejectMonitor = reject
    })

    console.log('🖥️ VM JOB: runtime Gold monitor started', {
        correlationId: pendingWebhook.correlationId,
        userId: pendingWebhook.userId,
        intervalMs,
        initialRuntimeGoldCharged: runtimeGoldCharged,
    })

    const tick = async () => {
        if (stopped || checking) return
        checking = true
        try {
            const nextRuntimeGoldCharged = await checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs,
                runtimeGoldCharged,
                vmJob,
            })
            if (!stopped) runtimeGoldCharged = nextRuntimeGoldCharged
        } catch (error) {
            if (stopped) return
            stopped = true
            if (timer) clearInterval(timer)
            if (typeof error.runtimeGoldCharged !== 'number') error.runtimeGoldCharged = runtimeGoldCharged
            rejectMonitor(error)
        } finally {
            checking = false
        }
    }

    timer = setInterval(tick, intervalMs)
    return {
        promise,
        stop: () => {
            stopped = true
            if (timer) clearInterval(timer)
        },
        getRuntimeGoldCharged: () => runtimeGoldCharged,
    }
}

function startVmCancellationMonitor({
    pendingRef,
    commandHandle,
    getRuntimeGoldCharged,
    intervalMs = 2000,
    correlationId = '',
}) {
    let stopped = false
    let checking = false
    let timer = null
    let rejectMonitor
    const promise = new Promise((_, reject) => {
        rejectMonitor = reject
    })

    const tick = async () => {
        if (stopped || checking) return
        checking = true
        try {
            if (await isVmJobCancellationRequested(pendingRef)) {
                stopped = true
                if (timer) clearInterval(timer)
                const runtimeGoldCharged = typeof getRuntimeGoldCharged === 'function' ? getRuntimeGoldCharged() : 0
                if (commandHandle && typeof commandHandle.kill === 'function') {
                    await commandHandle.kill().catch(error => {
                        console.warn('🖥️ VM JOB: failed killing command after cancellation', {
                            correlationId,
                            error: error.message,
                        })
                    })
                }
                rejectMonitor(new VmJobCancelledError(VM_JOB_CANCELLED_TEXT, runtimeGoldCharged))
            }
        } catch (error) {
            if (!stopped) {
                stopped = true
                if (timer) clearInterval(timer)
                rejectMonitor(error)
            }
        } finally {
            checking = false
        }
    }

    timer = setInterval(tick, intervalMs)
    tick().catch(() => {})
    return {
        promise,
        stop: () => {
            stopped = true
            if (timer) clearInterval(timer)
        },
    }
}

// One persistent VM session per chat thread.
function vmSessionDocId(vmJob) {
    return `${vmJob.projectId}__${vmJob.objectId}`
}

// Pause an E2B sandbox via the REST API (e2b@1.x exposes no pause() method). The paused
// sandbox keeps its full state and is resumable later via Sandbox.connect(sandboxId).
async function pauseE2bSandbox(sandboxId, e2bApiKey) {
    const resp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/pause`, {
        method: 'POST',
        headers: { 'X-API-KEY': e2bApiKey, 'Content-Type': 'application/json' },
    })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B pause ${resp.status}: ${body.substring(0, 200)}`)
    }
}

// Resume a PAUSED sandbox back to running. e2b@1.x's Sandbox.connect only attaches to a
// RUNNING sandbox — it does NOT auto-resume a paused one (operations 404 otherwise), so a
// paused session must be resumed via this REST call first. `timeout` is the new TTL (seconds).
async function resumeE2bSandbox(sandboxId, e2bApiKey, timeoutSec) {
    const resp = await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}/resume`, {
        method: 'POST',
        headers: { 'X-API-KEY': e2bApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: timeoutSec, autoPause: false }),
    })
    if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`E2B resume ${resp.status}: ${body.substring(0, 200)}`)
    }
}

// After a run, KEEP the sandbox running for the keep-alive grace window (so back-to-back
// tasks hit a live VM) and record the session as 'running'. The scheduled pauser pauses it
// once idle. If keep-alive can't be set, fall back to pausing now; if that also fails, kill.
async function keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey) {
    const sandboxId = sandbox.sandboxId || sandbox.id
    const baseDoc = {
        sandboxId,
        agent: vmJob.agent || DEFAULT_AGENT,
        template: vmJob.vmTemplate || '',
        projectId: vmJob.projectId,
        objectId: vmJob.objectId,
        lastUsedAt: Date.now(),
    }
    try {
        await sandbox.setTimeout(KEEP_ALIVE_KILL_MS) // stays alive ~15 min unless reused/paused
        await sessionRef.set({ ...baseDoc, status: 'running' }, { merge: true })
        console.log('🖥️ VM JOB: session kept alive (running)', {
            correlationId: vmJob.correlationId,
            sandboxId,
            graceMs: KEEP_ALIVE_GRACE_MS,
        })
    } catch (error) {
        console.warn('🖥️ VM JOB: keep-alive failed — pausing instead', {
            correlationId: vmJob.correlationId,
            error: error.message,
        })
        try {
            await pauseE2bSandbox(sandboxId, e2bApiKey)
            await sessionRef.set({ ...baseDoc, status: 'paused' }, { merge: true })
        } catch (e2) {
            try {
                await sandbox.kill()
            } catch (_) {}
            await sessionRef.delete().catch(() => {})
        }
    }
}

// Scheduled pauser: pause running sandboxes that have been idle past the keep-alive window,
// so we stop paying compute while preserving state for a later resume.
async function pauseIdleVmSessions() {
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    if (!e2bApiKey) return
    const cutoff = Date.now() - KEEP_ALIVE_GRACE_MS
    // Single-field query (no composite index); filter to running in code.
    const snap = await admin.firestore().collection('vmSessions').where('lastUsedAt', '<', cutoff).get()
    const running = snap.docs.filter(d => (d.data().status || 'paused') === 'running' && d.data().sandboxId)
    console.log('💤 VM SESSIONS PAUSER: idle running sessions', { count: running.length })
    for (const doc of running) {
        const s = doc.data()
        try {
            await pauseE2bSandbox(s.sandboxId, e2bApiKey)
            await doc.ref.set({ status: 'paused', pausedAt: Date.now() }, { merge: true })
            console.log('💤 VM SESSIONS PAUSER: paused', { sandboxId: s.sandboxId })
        } catch (error) {
            // Likely already killed (kill timeout) — clear so the thread starts fresh next time.
            console.warn('💤 VM SESSIONS PAUSER: pause failed, clearing session', {
                sandboxId: s.sandboxId,
                error: error.message,
            })
            await doc.ref.delete().catch(() => {})
        }
    }
}

// Scheduled cleanup: delete paused sandboxes (and their session docs) idle longer than the TTL.
async function cleanupIdleVmSessions() {
    const { Sandbox } = require('e2b')
    const e2bApiKey = getEnvFunctions().E2B_API_KEY
    const cutoff = Date.now() - SESSION_TTL_MS
    const snap = await admin.firestore().collection('vmSessions').where('lastUsedAt', '<', cutoff).get()
    console.log('🧹 VM SESSIONS CLEANUP: idle sessions found', { count: snap.size })
    for (const doc of snap.docs) {
        const s = doc.data()
        if (s.sandboxId && e2bApiKey) {
            try {
                await Sandbox.kill(s.sandboxId, { apiKey: e2bApiKey })
            } catch (error) {
                console.warn('🧹 VM SESSIONS CLEANUP: kill failed', { sandboxId: s.sandboxId, error: error.message })
            }
        }
        await doc.ref.delete().catch(() => {})
    }
}

async function prepareSubscriptionCredential(sandbox, subscriptionAuth) {
    if (!subscriptionAuth || subscriptionAuth.mode !== 'subscription' || subscriptionAuth.provider !== 'codex') return
    await sandbox.commands.run(`mkdir -p ${CODEX_AUTH_DIR} && chmod 700 ${CODEX_AUTH_DIR}`)
    await sandbox.files.write(CODEX_AUTH_PATH, subscriptionAuth.credential)
    await sandbox.commands.run(`chmod 600 ${CODEX_AUTH_PATH}`)
}

async function persistAndRemoveSubscriptionCredential(sandbox, subscriptionAuth, userId) {
    if (!subscriptionAuth || subscriptionAuth.mode !== 'subscription' || subscriptionAuth.provider !== 'codex') return
    try {
        const refreshedAuthJson = await sandbox.files.read(CODEX_AUTH_PATH)
        const { persistRefreshedCodexAuth } = require('./vmSubscriptionAuth')
        await persistRefreshedCodexAuth(userId, refreshedAuthJson)
    } catch (error) {
        console.warn('🖥️ VM JOB: could not persist refreshed Codex subscription auth', {
            userId,
            error: error.message,
        })
    } finally {
        await sandbox.commands.run(`rm -f ${CODEX_AUTH_PATH}`).catch(() => {})
    }
}

/**
 * Run the selected agent (Claude Code or Codex) headless in an E2B sandbox and return its
 * final output. Resumes the chat thread's paused sandbox if one exists (so the agent
 * continues with prior files + conversation), else starts fresh. Parses the agent's JSON
 * event stream to surface live activity via onActivity(text), and pauses the sandbox on
 * completion so the session can be resumed later.
 */
async function runAgentInSandbox(
    vmJob,
    config,
    apiKey,
    e2bApiKey,
    onActivity,
    gitContext = null,
    gcpContext = null,
    pendingWebhook = null,
    pendingRef = null,
    subscriptionAuth = null
) {
    const { Sandbox } = require('e2b')
    const agentLabel = config.displayName || config.label || getAgentLabel(vmJob.agent || DEFAULT_AGENT)
    // Model + effort the agent runs with, surfaced in the live status header.
    const runDetails = resolveAgentRunDetails(vmJob)
    const credentialMode = subscriptionAuth ? 'subscription' : vmJob.credentialMode === 'byok' ? 'byok' : 'api'
    // Always use E2B's managed prebuilt template for the selected agent.
    const template = config.defaultTemplate
    vmJob.vmTemplate = template
    const sessionRef = admin.firestore().doc(`vmSessions/${vmSessionDocId(vmJob)}`)

    // Resume the thread's paused sandbox (same agent) if there is one; else create fresh.
    let sandbox = null
    let sandboxLeaseDeadlineMs = null
    let isResume = false
    let subscriptionCredentialPrepared = false
    let runtimeGoldCharged = Number(pendingWebhook?.runtimeGoldCharged) || 0
    try {
        const sessSnap = await sessionRef.get()
        const sess = sessSnap.exists ? sessSnap.data() : null
        const selectedAgent = vmJob.agent || DEFAULT_AGENT
        const sessionMatchesAgent = sess && sess.agent === selectedAgent
        const sessionMatchesTemplate = sess && sess.template === template
        if (sess && sess.sandboxId && (!sessionMatchesAgent || !sessionMatchesTemplate)) {
            console.log('🖥️ VM JOB: discarding incompatible session', {
                correlationId: vmJob.correlationId,
                sandboxId: sess.sandboxId,
                previousAgent: sess.agent || null,
                previousTemplate: sess.template || null,
                selectedAgent,
                selectedTemplate: template,
            })
            await Sandbox.kill(sess.sandboxId, { apiKey: e2bApiKey }).catch(() => {})
            await sessionRef.delete().catch(() => {})
        } else if (sess && sess.sandboxId && sessionMatchesAgent && sessionMatchesTemplate) {
            try {
                // A paused sandbox must be explicitly resumed first (connect alone won't
                // auto-resume it on e2b@1.x); a still-running one (keep-alive) just connects.
                if (sess.status !== 'running') {
                    await resumeE2bSandbox(sess.sandboxId, e2bApiKey, Math.ceil(E2B_SANDBOX_TIMEOUT_MS / 1000))
                }
                const resumedSandbox = await Sandbox.connect(sess.sandboxId, {
                    apiKey: e2bApiKey,
                    allowInternetAccess: true,
                })
                await resumedSandbox.setTimeout(E2B_SANDBOX_TIMEOUT_MS)
                sandboxLeaseDeadlineMs = Date.now() + E2B_SANDBOX_TIMEOUT_MS
                sandbox = resumedSandbox
                isResume = true
                console.log('🖥️ VM JOB: resumed session', {
                    correlationId: vmJob.correlationId,
                    sandboxId: sess.sandboxId,
                    wasPaused: sess.status !== 'running',
                })
            } catch (error) {
                console.warn('🖥️ VM JOB: resume failed, starting fresh', {
                    correlationId: vmJob.correlationId,
                    error: error.message,
                })
                await sessionRef.delete().catch(() => {})
            }
        }
    } catch (error) {
        console.warn('🖥️ VM JOB: session lookup failed', { correlationId: vmJob.correlationId, error: error.message })
    }

    if (!sandbox) {
        const createOpts = { apiKey: e2bApiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS, allowInternetAccess: true }
        console.log('🖥️ VM JOB: creating sandbox', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            template,
            timeoutMs: E2B_SANDBOX_TIMEOUT_MS,
        })
        const sandboxCreateStartedAt = Date.now()
        sandbox = template ? await Sandbox.create(template, createOpts) : await Sandbox.create(createOpts)
        sandboxLeaseDeadlineMs = sandboxCreateStartedAt + E2B_SANDBOX_TIMEOUT_MS
    }
    console.log('🖥️ VM JOB: sandbox ready', {
        correlationId: vmJob.correlationId,
        sandboxId: sandbox.sandboxId || sandbox.id || null,
        resume: isResume,
    })

    try {
        await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)
        const prompt = buildAgentPrompt(vmJob, gitContext, gcpContext)
        await sandbox.files.write('/home/user/prompt.txt', prompt)
        const contextFileContent = [vmJob.packagedContext, vmJob.threadContext].filter(Boolean).join('\n\n---\n\n')
        await sandbox.files.write('/home/user/context.md', contextFileContent)
        // A resumed sandbox must never retain an auth cache from an interrupted earlier run.
        await sandbox.commands.run(`rm -f ${CODEX_AUTH_PATH}`).catch(() => {})
        await prepareSubscriptionCredential(sandbox, subscriptionAuth)
        subscriptionCredentialPrepared = !!subscriptionAuth && subscriptionAuth.provider === 'codex'
        await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)

        // Mount the assistant's enabled skills so the agent's native skill discovery
        // (Claude: ~/.claude/skills, Codex: ~/.agents/skills) picks them up. The mount
        // dir is wiped first so a resumed session drops skills disabled since last run.
        const { loadEnabledSkillsForAssistant, mountSkillsInSandbox } = require('./assistantSkills')
        const enabledSkills = await loadEnabledSkillsForAssistant(vmJob.projectId, vmJob.assistantId).catch(error => {
            console.warn('🖥️ VM JOB: loading skills failed — continuing without skills', {
                correlationId: vmJob.correlationId,
                error: error.message,
            })
            return []
        })
        await mountSkillsInSandbox(sandbox, enabledSkills, vmJob.agent || DEFAULT_AGENT, vmJob.correlationId)
        await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)

        // Clone/refresh the connected GitLab repo and configure auth before the agent runs.
        if (gitContext && gitContext.enabled) {
            if (typeof onActivity === 'function') {
                onActivity(
                    `${renderVmWorkingHeader(agentLabel, runDetails, credentialMode)}\n\n📥 ${
                        isResume ? 'Refreshing' : 'Cloning'
                    } the connected repository…`
                )
            }
            await setupGitRepo(sandbox, gitContext, vmJob.correlationId)
            await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)
        }

        // Managed templates usually already contain the selected CLI. Keep startup fast and
        // resilient by installing only when it is missing, in a separately logged stage whose
        // sanitized error can be returned without swallowing npm diagnostics.
        await ensureAgentCliAvailable(
            sandbox,
            config,
            agentLabel,
            onActivity,
            renderVmWorkingHeader(agentLabel, runDetails, !!subscriptionAuth)
        )
        await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)

        const state = { activity: [], finalResult: '', assistantText: '', usage: null }
        let stdoutBuf = ''
        let stderr = ''

        // The agent emits one JSON event per line. Parse complete lines, let the
        // agent-specific handler update activity + capture the final answer, and push
        // a fresh activity log to the chat whenever a new line is added.
        const handleLine = rawLine => {
            const line = rawLine.trim()
            if (!line) return
            let evt
            try {
                evt = JSON.parse(line)
            } catch (_) {
                return // non-JSON noise (e.g. stray install output) — ignore
            }
            const before = state.activity.length
            config.handleEvent(evt, state)
            if (state.activity.length > before && typeof onActivity === 'function') {
                onActivity(renderActivityLog(state.activity, agentLabel, runDetails, credentialMode))
            }
        }
        const handleStdout = data => {
            stdoutBuf += data
            let idx
            while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
                handleLine(stdoutBuf.slice(0, idx))
                stdoutBuf = stdoutBuf.slice(idx + 1)
            }
        }
        const handleStderr = data => {
            stderr += data
        }

        // Run the agent headless. The prompt is passed as a positional argument (NOT piped
        // via stdin — reading stdin can hang non-interactively), and stdin is from /dev/null
        // so any unexpected interactive read gets EOF instead of blocking until the timeout.
        // For a git-enabled coding task the working dir is the cloned repo; deliverable files
        // still go to the absolute /home/user/output. Git credentials are injected per-command
        // via envs (never persisted to disk).
        const workdir = gitContext && gitContext.enabled ? REPO_DIR : '/home/user'
        // API-billed jobs keep the real platform key behind the short-lived proxy. Personal
        // subscription jobs use the requesting user's explicit Claude OAuth / Codex auth cache.
        const agentCredentials = subscriptionAuth
            ? { ...subscriptionAuth, mode: 'subscription' }
            : require('./vmLlmProxy').buildVmAgentCredentials({
                  vmJob,
                  agent: vmJob.agent || DEFAULT_AGENT,
                  realApiKey: apiKey,
                  credentialMode,
                  ttlMs: MAX_VM_RUNTIME_MS + 5 * 60 * 1000,
              })
        console.log('🖥️ VM JOB: agent credential mode', {
            correlationId: vmJob.correlationId,
            mode: agentCredentials.mode,
        })
        const agentEnv = config.sandboxEnv(agentCredentials)
        const runEnvs = buildSandboxCommandEnv(
            agentEnv,
            gitContext && gitContext.enabled ? buildGitEnv(gitContext) : null,
            gcpContext && gcpContext.enabled ? buildGcpEnv(gcpContext) : null
        )
        const command = `export PATH=${AGENT_CLI_NPM_PREFIX}/bin:$PATH && mkdir -p /home/user/output && cd ${workdir} && ${config.buildRun(
            isResume,
            {
                agentModel: runDetails.model,
                agentReasoningEffort: runDetails.effort,
                proxyBaseUrl: agentCredentials.baseUrl,
                subscriptionUsed: !!subscriptionAuth,
            }
        )}`

        const runStartMs = Date.now()
        const agentRuntimeMs = resolveVmAgentRuntimeMs(sandboxLeaseDeadlineMs, runStartMs)
        const commandTimeoutMs = Math.min(E2B_SANDBOX_TIMEOUT_MS, agentRuntimeMs + E2B_SANDBOX_TERMINATION_GRACE_MS)
        console.log('🖥️ VM JOB: running agent command', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            resume: isResume,
            agentRuntimeMs,
            commandTimeoutMs,
        })
        let result
        try {
            const commandHandle = await sandbox.commands.run(`bash -lc '${command.replace(/'/g, `'\\''`)}'`, {
                envs: runEnvs,
                timeoutMs: commandTimeoutMs,
                background: true,
                onStdout: handleStdout,
                onStderr: handleStderr,
            })
            const commandPromise = commandHandle.wait()
            const runtimeTimeout = startVmRuntimeTimeout(commandHandle, agentRuntimeMs, MAX_VM_RUNTIME_MS)
            const monitor =
                pendingWebhook && pendingRef
                    ? startVmRuntimeGoldMonitor({
                          pendingWebhook,
                          pendingRef,
                          commandHandle,
                          runStartMs,
                          vmJob,
                          initialRuntimeGoldCharged: runtimeGoldCharged,
                      })
                    : null
            const cancellationMonitor = pendingRef
                ? startVmCancellationMonitor({
                      pendingRef,
                      commandHandle,
                      getRuntimeGoldCharged: () => (monitor ? monitor.getRuntimeGoldCharged() : runtimeGoldCharged),
                      correlationId: vmJob.correlationId,
                  })
                : null

            try {
                result = await Promise.race([
                    commandPromise,
                    runtimeTimeout.promise,
                    monitor ? monitor.promise : new Promise(() => {}),
                    cancellationMonitor ? cancellationMonitor.promise : new Promise(() => {}),
                ])
            } catch (error) {
                if (isVmGoldExhaustedError(error) || isVmJobCancelledError(error) || isVmRuntimeTimeoutError(error)) {
                    runtimeGoldCharged = error.runtimeGoldCharged || runtimeGoldCharged
                    await commandPromise.catch(() => {})
                }
                throw error
            } finally {
                if (monitor) {
                    monitor.stop()
                    runtimeGoldCharged = monitor.getRuntimeGoldCharged()
                }
                if (cancellationMonitor) cancellationMonitor.stop()
                runtimeTimeout.stop()
            }
        } catch (runError) {
            if (stdoutBuf.trim()) handleLine(stdoutBuf)
            if (isVmGoldExhaustedError(runError) || isVmJobCancelledError(runError)) throw runError
            // The command was killed (e.g. timeout) before returning — log whatever it
            // produced so we can see where the agent got stuck, then rethrow.
            const detailedError = buildAgentExitError(agentLabel, null, state, stderr, runError)
            console.error('🖥️ VM JOB: command errored/terminated', {
                correlationId: vmJob.correlationId,
                agent: config.label,
                error: detailedError.message,
                events: state.activity.length,
                lastActivity: state.activity.slice(-3).map(line => sanitizeVmErrorText(line)),
                stdoutBufLen: stdoutBuf.length,
                stderrLen: stderr.length,
                stderrPreview: sanitizeVmErrorText(stderr, 800),
                runtimeGoldCharged,
            })
            const errorToThrow = selectVmCommandError(runError, detailedError)
            if (typeof errorToThrow.runtimeGoldCharged !== 'number') {
                errorToThrow.runtimeGoldCharged =
                    typeof runError.runtimeGoldCharged === 'number' ? runError.runtimeGoldCharged : runtimeGoldCharged
            }
            throw errorToThrow
        }
        if (stdoutBuf.trim()) handleLine(stdoutBuf) // flush any trailing partial line
        await throwIfVmJobCancelled(pendingRef, runtimeGoldCharged)
        console.log('🖥️ VM JOB: command finished', {
            correlationId: vmJob.correlationId,
            agent: config.label,
            exitCode: result?.exitCode,
            events: state.activity.length,
            finalResultLen: (state.finalResult || state.assistantText).length,
            stderrLen: stderr.length,
            stderrPreview: sanitizeVmErrorText(stderr, 300),
        })

        const output = (state.finalResult || state.assistantText || '').trim()
        if (result?.exitCode !== undefined && result.exitCode !== 0) {
            throw buildAgentExitError(agentLabel, result, state, stderr)
        }
        if (!output) {
            throw buildAgentExitError(agentLabel, result, state, stderr, new Error('Agent produced no output.'))
        }
        // Collect deliverable files written during THIS run (while the sandbox is still alive).
        const artifacts = await collectArtifacts(sandbox, vmJob.correlationId, runStartMs)
        if (subscriptionCredentialPrepared) {
            await persistAndRemoveSubscriptionCredential(sandbox, subscriptionAuth, vmJob.requestUserId)
            subscriptionCredentialPrepared = false
        }
        // Keep the sandbox alive (grace window) + record the session so the thread can resume it.
        await keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey)
        return { output, usage: state.usage, artifacts, runtimeGoldCharged }
    } catch (err) {
        if (subscriptionCredentialPrepared) {
            await persistAndRemoveSubscriptionCredential(sandbox, subscriptionAuth, vmJob.requestUserId)
            subscriptionCredentialPrepared = false
        }
        // Preserve the session on failure too, so prior work in the thread isn't lost.
        await keepVmSessionAlive(sessionRef, sandbox, vmJob, e2bApiKey).catch(() => {})
        if (typeof err.runtimeGoldCharged !== 'number') err.runtimeGoldCharged = runtimeGoldCharged
        throw err
    }
}

/**
 * Refund the Gold charged for a job that failed before producing a result.
 */
async function refundVmJob(pendingWebhook, reason, extraGold = 0) {
    const amount = (Number(pendingWebhook.goldCharged) || 0) + (Number(extraGold) || 0)
    if (!amount) return
    try {
        const { refundGold } = require('../Gold/goldHelper')
        await refundGold(pendingWebhook.userId, amount, {
            source: VM_JOB_GOLD_REFUND_SOURCE,
            channel: 'assistant',
            projectId: pendingWebhook.projectId,
            objectId: pendingWebhook.objectId,
            objectType: pendingWebhook.objectType,
            note: reason || 'VM task failed',
        })
    } catch (error) {
        console.error('🖥️ VM JOB: Failed to refund Gold', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
    }
}

/**
 * Upload the agent's generated files to Firebase Storage and build the `mediaContext`
 * array the chat uses for attachments (same shape as user-uploaded chat files).
 */
async function uploadArtifacts(pendingWebhook, artifacts) {
    if (!Array.isArray(artifacts) || !artifacts.length) return []
    const { v4: uuidv4 } = require('uuid')
    const bucket = admin.storage().bucket()
    const commentId = pendingWebhook.statusCommentId || pendingWebhook.correlationId
    const mediaContext = []
    for (const artifact of artifacts) {
        try {
            const token = uuidv4()
            const storagePath = `attachments/${commentId}/${artifact.fileName}`
            await bucket.file(storagePath).save(artifact.bytes, {
                resumable: false,
                contentType: artifact.mimeType,
                metadata: { metadata: { firebaseStorageDownloadTokens: token } },
            })
            const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
                storagePath
            )}?alt=media&token=${token}`
            const isImage = artifact.mimeType.startsWith('image/')
            mediaContext.push({
                kind: isImage ? 'image' : 'file',
                fileName: artifact.fileName,
                mimeType: artifact.mimeType,
                storageUrl,
                previewUrl: isImage ? storageUrl : '',
                extractedText: '',
                extractionStatus: '',
            })
        } catch (error) {
            console.warn('🖥️ VM JOB: failed uploading artifact', {
                correlationId: pendingWebhook.correlationId,
                name: artifact.fileName,
                error: error.message,
            })
        }
    }
    return mediaContext
}

/**
 * Charge the metered Gold top-up after a successful run: per-minute (E2B compute) +
 * per-token (LLM usage). The base reserve was already charged up-front in startVmJob.
 * If the user can't cover the full amount, charge whatever balance remains.
 */
async function chargeVmTopup(
    pendingWebhook,
    vmJob,
    {
        topup,
        minutes,
        totalTokens,
        costUsd,
        runtimeGoldAlreadyCharged = 0,
        runtimeGoldRemaining = 0,
        tokenGold = 0,
        proxyTokenGoldCharged = 0,
        subscriptionUsed = false,
        credentialMode = subscriptionUsed ? 'subscription' : 'api',
    }
) {
    if (!topup || topup <= 0) return
    const { deductGold } = require('../Gold/goldHelper')
    const note =
        `VM ${vmJob.agent || 'claude'} metered: ${minutes} min ` +
        `(${runtimeGoldAlreadyCharged} runtime Gold already charged, ${runtimeGoldRemaining} runtime Gold remaining) ` +
        `+ ${totalTokens} tokens (${
            credentialMode === 'byok'
                ? 'personal API key, provider-billed, 0 Gold'
                : subscriptionUsed
                ? 'personal subscription, 0 Gold'
                : `${proxyTokenGoldCharged} proxy token Gold already charged, ${tokenGold} token Gold remaining`
        })` +
        (typeof costUsd === 'number' ? ` (~$${costUsd.toFixed(2)})` : '')
    const ctx = {
        source: VM_JOB_GOLD_SOURCE,
        channel: 'assistant',
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType,
        note,
    }
    const result = await deductGold(pendingWebhook.userId, topup, ctx).catch(() => null)
    // Run already completed — if the user lacks enough Gold, take what's left.
    if (result && result.success === false && typeof result.currentGold === 'number' && result.currentGold > 0) {
        await deductGold(pendingWebhook.userId, result.currentGold, ctx).catch(() => {})
    }
}

function isWhatsAppTriggeredVmJob(pendingWebhook) {
    return (
        pendingWebhook?.triggerChannel === 'whatsapp' &&
        typeof pendingWebhook?.whatsappTo === 'string' &&
        pendingWebhook.whatsappTo.trim().length > 0
    )
}

// Build the WhatsApp result message. When the run produced downloadable artifacts, lead with each
// file's public download URL so a WhatsApp-originated request gets the link first — matching the
// chat comment (buildVmFinalCommentText also puts artifacts before the answer). The chat-only
// attachment tokens (ATTACHMENT_TRIGGER) can't render in WhatsApp, so we send the raw URLs.
// Putting the links first also means they survive the WhatsApp plain-message cap: the service
// truncates the tail of long messages (and appends a "read full message" thread link), so the
// answer text is what gets trimmed, never the links. Falls back to the plain answer for
// text-only completions and failure notifications (no mediaContext).
function buildWhatsAppVmResultMessage(output, { mediaContext = [] } = {}) {
    const message = String(output || '').trim() || 'The VM task completed.'
    const files = Array.isArray(mediaContext) ? mediaContext.filter(m => m && m.storageUrl) : []
    if (!files.length) return message

    const heading = files.length === 1 ? 'Generated file:' : 'Generated files:'
    const links = files.map(m => `${m.fileName || 'file'}: ${m.storageUrl}`).join('\n')
    return `${heading}\n${links}\n\n${message}`
}

async function sendWhatsAppVmResultNotification(
    pendingWebhook,
    output,
    { mediaContext = [], pendingRef = null, notificationType = 'completed' } = {}
) {
    if (!isWhatsAppTriggeredVmJob(pendingWebhook)) return null

    const attemptedAt = Date.now()
    const baseLog = {
        correlationId: pendingWebhook.correlationId,
        projectId: pendingWebhook.projectId,
        objectId: pendingWebhook.objectId,
        objectType: pendingWebhook.objectType || 'tasks',
        notificationType,
    }

    try {
        const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
        const whatsappService = new TwilioWhatsAppService()
        const message = buildWhatsAppVmResultMessage(output, { mediaContext })
        const result = await whatsappService.sendWhatsAppMessageWithConversationLink(
            pendingWebhook.whatsappTo,
            message,
            {
                projectId: pendingWebhook.projectId,
                objectId: pendingWebhook.objectId,
                objectType: pendingWebhook.objectType || 'tasks',
            }
        )

        const notificationData = {
            type: notificationType,
            attemptedAt,
            success: result?.success === true,
            sid: result?.sid || null,
            status: result?.status || null,
            error: result?.success === true ? null : result?.error || result?.message || 'WhatsApp send failed',
        }
        if (pendingRef) {
            await pendingRef.update({ whatsappNotification: notificationData }).catch(() => {})
        }

        if (notificationData.success) {
            console.log('🖥️ VM JOB: WhatsApp result notification sent', {
                ...baseLog,
                sid: notificationData.sid,
            })
        } else {
            console.warn('🖥️ VM JOB: WhatsApp result notification failed', {
                ...baseLog,
                error: notificationData.error,
            })
        }
        return notificationData
    } catch (error) {
        const notificationData = {
            type: notificationType,
            attemptedAt,
            success: false,
            sid: null,
            status: null,
            error: error.message,
        }
        if (pendingRef) {
            await pendingRef.update({ whatsappNotification: notificationData }).catch(() => {})
        }
        console.warn('🖥️ VM JOB: WhatsApp result notification errored', {
            ...baseLog,
            error: error.message,
        })
        return notificationData
    }
}

const VM_ORIGIN_NOTE_SNIPPET_MAX = 600

// Post a short completion note back into the conversation the job was delegated from (e.g. the
// WhatsApp daily topic where the user talked to Anna), so the user sees the outcome where they
// are actually talking — not only in the separate host task. No-op when there is no distinct
// origin conversation on the job.
async function postVmOriginConversationNote(pendingWebhook, text, { notificationType = 'completed' } = {}) {
    const originProjectId = typeof pendingWebhook?.originProjectId === 'string' ? pendingWebhook.originProjectId : ''
    const originObjectId = typeof pendingWebhook?.originObjectId === 'string' ? pendingWebhook.originObjectId : ''
    const originObjectType =
        typeof pendingWebhook?.originObjectType === 'string' && pendingWebhook.originObjectType
            ? pendingWebhook.originObjectType
            : 'topics'
    const originAssistantId =
        typeof pendingWebhook?.originAssistantId === 'string' ? pendingWebhook.originAssistantId : ''
    if (!originProjectId || !originObjectId || !originAssistantId) return null
    // Don't double-post if the origin conversation is the host thread itself.
    if (originProjectId === pendingWebhook.projectId && originObjectId === pendingWebhook.objectId) return null

    const hostObjectType = pendingWebhook.objectType || 'tasks'
    const link = buildVmChatLink(pendingWebhook.projectId, hostObjectType, pendingWebhook.objectId)
    const icon = notificationType === 'completed' ? '✅' : notificationType === 'cancelled' ? '🛑' : '❌'
    const verb =
        notificationType === 'completed' ? 'finished' : notificationType === 'cancelled' ? 'was cancelled' : 'failed'
    const snippet = shrinkTagText(
        cleanTextMetaData(removeFormatTagsFromText(text || ''), true),
        VM_ORIGIN_NOTE_SNIPPET_MAX
    )
    const note = `${icon} The VM task you requested ${verb}.\n\n${snippet}\n\n${link}`

    try {
        const { createInitialStatusMessage } = require('./assistantStatusHelper')
        await createInitialStatusMessage(
            originProjectId,
            originObjectType,
            originObjectId,
            originAssistantId,
            note,
            [pendingWebhook.userId],
            [],
            [pendingWebhook.userId]
        )
        console.log('🖥️ VM JOB: Posted completion note to origin conversation', {
            correlationId: pendingWebhook.correlationId,
            originProjectId,
            originObjectId,
        })
        return true
    } catch (error) {
        console.warn('🖥️ VM JOB: Failed posting origin conversation note', {
            correlationId: pendingWebhook.correlationId,
            error: error.message,
        })
        return false
    }
}

// Fan a settled VM job's result out to the external channels the request came through: a direct
// WhatsApp message (when WhatsApp-triggered) and a continuity note in the origin conversation
// (when delegated from another thread). Both are best-effort and independent.
async function notifyVmResultChannels(pendingWebhook, text, opts = {}) {
    await sendWhatsAppVmResultNotification(pendingWebhook, text, opts)
    await postVmOriginConversationNote(pendingWebhook, text, { notificationType: opts.notificationType })
}

/**
 * Worker entry point: run a queued VM job to completion and post the result back
 * into the conversation. Invoked by the runVmJob onTaskDispatched function.
 */
async function runVmJobByCorrelationId(correlationId) {
    console.log('🖥️ VM JOB RUNNER: Starting', { correlationId })
    const db = admin.firestore()
    const pendingRef = db.doc(`pendingWebhooks/${correlationId}`)

    const [pendingDoc, jobDoc] = await Promise.all([pendingRef.get(), db.doc(`vmJobs/${correlationId}`).get()])
    if (!pendingDoc.exists || !jobDoc.exists) {
        console.error('🖥️ VM JOB RUNNER: Job records missing', { correlationId })
        return
    }
    const pendingWebhook = pendingDoc.data()
    const vmJob = jobDoc.data()

    // Idempotency: don't re-run a job that already settled.
    if (
        pendingWebhook.status === 'completed' ||
        pendingWebhook.status === 'failed' ||
        pendingWebhook.status === 'cancelled'
    ) {
        console.warn('🖥️ VM JOB RUNNER: Already settled, skipping', { correlationId, status: pendingWebhook.status })
        return
    }

    if (pendingWebhook.status === VM_JOB_CANCEL_REQUESTED_STATUS) {
        await writeStatusComment(pendingWebhook, VM_JOB_CANCELLED_TEXT, { assistantRunStatus: VM_JOB_CANCELLED_STATUS })
        await pendingRef
            .update({
                status: VM_JOB_CANCELLED_STATUS,
                cancelledAt: Date.now(),
            })
            .catch(() => {})
        await refundVmJob(pendingWebhook, 'VM task stopped before execution')
        return
    }

    const lease = await claimVmJobLease(pendingRef, correlationId)
    if (!lease.claimed) {
        console.warn('🖥️ VM JOB RUNNER: Active lease or settled job, skipping', { correlationId })
        return
    }
    const heartbeat = startVmJobHeartbeat(pendingRef, lease.leaseOwner)

    const env = getEnvFunctions()
    const e2bApiKey = env.E2B_API_KEY
    // Resolve the agent the assistant chose (defaults to Claude) and its config.
    const config = AGENT_CONFIGS[vmJob.agent] || AGENT_CONFIGS[DEFAULT_AGENT]
    const agentLabel = config.displayName || config.label || getAgentLabel(vmJob.agent || DEFAULT_AGENT)
    const runDetails = resolveAgentRunDetails(vmJob)
    const wantsSubscription = vmJob.credentialMode === 'subscription'
    const wantsByok = vmJob.credentialMode === 'byok'
    const subscriptionAuth = wantsSubscription
        ? await require('./vmSubscriptionAuth').loadVmSubscriptionAuth(
              vmJob.requestUserId,
              vmJob.agent || DEFAULT_AGENT
          )
        : null
    const byokStatus = wantsByok
        ? await require('./vmApiKeyAuth')
              .getVmApiKeyStatus(vmJob.requestUserId)
              .catch(() => null)
        : null
    const byokAvailable = !!byokStatus?.[vmJob.agent || DEFAULT_AGENT]?.connected
    const apiKey = env[config.apiKeyField]
    if (
        (wantsSubscription && !subscriptionAuth) ||
        (wantsByok && !byokAvailable) ||
        (!wantsSubscription && !wantsByok && !apiKey) ||
        !e2bApiKey
    ) {
        const message = wantsSubscription
            ? `VM task could not run: your ${agentLabel} subscription connection is missing. Reconnect it in Settings → Integrations.`
            : wantsByok
            ? `VM task could not run: your personal ${agentLabel} API key is missing. Add or replace it in Settings → Integrations.`
            : `VM task could not run: ${config.label} sandbox credentials are not configured.`
        const failureText = `❌ ${message}`
        await writeStatusComment(pendingWebhook, failureText, { assistantRunStatus: 'failed' })
        await notifyVmResultChannels(pendingWebhook, failureText, {
            pendingRef,
            notificationType: 'failed',
        })
        await pendingRef.update({ status: 'failed', error: message, failedAt: Date.now() }).catch(() => {})
        await refundVmJob(pendingWebhook, 'Missing sandbox credentials')
        heartbeat.stop()
        return
    }

    // Throttled live-activity updates to the single status comment. The worker passes
    // a fully-rendered activity log; we just rate-limit the Firestore writes.
    let lastProgressAt = 0
    const onActivity = text => {
        const now = Date.now()
        if (now - lastProgressAt < PROGRESS_UPDATE_INTERVAL_MS) return
        lastProgressAt = now
        writeStatusComment(pendingWebhook, text).catch(() => {})
    }

    // For a coding ("prototype") task, surface the project's connected repo (GitHub or GitLab)
    // so the agent works inside it and opens a Pull/Merge Request. Other task types unaffected.
    let gitContext = null
    if (vmJob.taskType === 'prototype') {
        gitContext = await loadRepoContext(vmJob)
        if (gitContext && gitContext.enabled) {
            console.log('🖥️ VM JOB RUNNER: repo connected for coding task', {
                correlationId,
                provider: gitContext.provider,
                baseBranch: gitContext.baseBranch,
            })
        } else if (gitContext && gitContext.repoConnectedButNoToken) {
            console.log('🖥️ VM JOB RUNNER: repo connected but requesting user has no token', {
                correlationId,
            })
        }
    }

    // Read-only Google Cloud access is useful for any task type (not just coding), so load it
    // unconditionally. Best-effort: a null result just means the task runs without GCP access.
    const gcpContext = await loadGcpContext(vmJob)
    if (gcpContext && gcpContext.enabled) {
        console.log('🖥️ VM JOB RUNNER: GCP project connected', {
            correlationId,
            gcpProjectId: gcpContext.gcpProjectId,
            capabilities: gcpContext.capabilities,
        })
    }

    try {
        const credentialMode = subscriptionAuth ? 'subscription' : wantsByok ? 'byok' : 'api'
        const tokenBillingExempt = credentialMode !== 'api'
        await throwIfVmJobCancelled(pendingRef)
        await pendingRef
            .update({
                credentialMode,
                subscriptionUsed: credentialMode === 'subscription',
                personalApiKeyUsed: credentialMode === 'byok',
                tokenBillingExempt,
            })
            .catch(() => {})
        await writeStatusComment(pendingWebhook, renderVmWorkingHeader(agentLabel, runDetails, credentialMode))
        const { output, usage, artifacts, runtimeGoldCharged = 0 } = await runAgentInSandbox(
            vmJob,
            config,
            apiKey,
            e2bApiKey,
            onActivity,
            gitContext && gitContext.enabled ? gitContext : null,
            gcpContext && gcpContext.enabled ? gcpContext : null,
            pendingWebhook,
            pendingRef,
            subscriptionAuth
        )

        // Upload any generated files and attach them to the result comment as real chat
        // attachment tokens (render as inline downloadable FileDownloadableTags). Keep the
        // tokens on their own first line so generated artifacts are visible before the VM answer.
        const mediaContext = await uploadArtifacts(pendingWebhook, artifacts)
        const finalText = buildVmFinalCommentText(output, mediaContext)

        // Auto-presentation: the agent's final message (+ attachments) becomes the comment.
        await writeStatusComment(pendingWebhook, finalText, { isFinal: true, output: finalText, mediaContext })
        await notifyVmResultChannels(pendingWebhook, output, {
            mediaContext,
            pendingRef,
            notificationType: 'completed',
        })

        // Metered Gold top-up from actual usage: per-minute (VM compute) + per-token (LLM).
        const runtimeMs = Date.now() - (vmJob.createdAt || Date.now())
        const latestPendingSnap = await pendingRef.get().catch(() => null)
        const latestPendingData = latestPendingSnap && latestPendingSnap.exists ? latestPendingSnap.data() || {} : {}
        const proxyTokenGoldCharged = Number(latestPendingData.proxyTokenGoldCharged) || 0
        const {
            minutes,
            totalTokens,
            runtimeGoldRemaining,
            tokenGold,
            tokenGoldTotal,
            topup,
        } = calculateCompletionGoldCharges({
            runtimeMs,
            usage,
            runtimeGoldCharged,
            proxyTokenGoldCharged,
            subscriptionUsed: tokenBillingExempt,
        })
        await chargeVmTopup(pendingWebhook, vmJob, {
            topup,
            minutes,
            totalTokens,
            costUsd: usage?.costUsd,
            runtimeGoldAlreadyCharged: runtimeGoldCharged,
            runtimeGoldRemaining,
            tokenGold,
            proxyTokenGoldCharged,
            subscriptionUsed: tokenBillingExempt,
            credentialMode,
        })

        await pendingRef
            .update({
                status: 'completed',
                completedAt: Date.now(),
                runtimeMs,
                usage: usage || null,
                goldTopup: runtimeGoldCharged + proxyTokenGoldCharged + topup,
                runtimeGoldCharged,
                proxyTokenGoldCharged,
                credentialMode,
                subscriptionUsed: credentialMode === 'subscription',
                personalApiKeyUsed: credentialMode === 'byok',
                tokenBillingExempt,
                artifactCount: mediaContext.length,
            })
            .catch(() => {})
        console.log('🖥️ VM JOB RUNNER: Completed', {
            correlationId,
            outputLength: output.length,
            artifacts: mediaContext.length,
            minutes,
            totalTokens,
            runtimeGoldCharged,
            runtimeGoldRemaining,
            proxyTokenGoldCharged,
            subscriptionUsed: credentialMode === 'subscription',
            personalApiKeyUsed: credentialMode === 'byok',
            tokenBillingExempt,
            tokenGoldTotal,
            tokenGold,
            topup,
            costUsd: usage?.costUsd ?? null,
        })
    } catch (error) {
        console.error('🖥️ VM JOB RUNNER: Failed', { correlationId, error: error.message, stack: error.stack })
        const runtimeGoldCharged = Number(error.runtimeGoldCharged) || 0
        const latestPendingSnap = await pendingRef.get().catch(() => null)
        const latestPendingData = latestPendingSnap && latestPendingSnap.exists ? latestPendingSnap.data() || {} : {}
        const proxyTokenGoldCharged = Number(latestPendingData.proxyTokenGoldCharged) || 0
        if (isVmGoldExhaustedError(error) || latestPendingData.failureReason === VM_GOLD_EXHAUSTED_FAILURE_REASON) {
            await writeStatusComment(pendingWebhook, VM_GOLD_EXHAUSTED_TEXT, { assistantRunStatus: 'failed' })
            await notifyVmResultChannels(pendingWebhook, VM_GOLD_EXHAUSTED_TEXT, {
                pendingRef,
                notificationType: 'failed',
            })
            await pendingRef
                .update({
                    status: 'failed',
                    error: VM_GOLD_EXHAUSTED_TEXT,
                    failureReason: VM_GOLD_EXHAUSTED_FAILURE_REASON,
                    interruptedAt: Date.now(),
                    runtimeGoldCharged,
                    proxyTokenGoldCharged,
                })
                .catch(() => {})
            return
        }

        if (isVmJobCancelledError(error) || latestPendingData.status === VM_JOB_CANCEL_REQUESTED_STATUS) {
            await writeStatusComment(pendingWebhook, VM_JOB_CANCELLED_TEXT, {
                assistantRunStatus: VM_JOB_CANCELLED_STATUS,
            })
            await notifyVmResultChannels(pendingWebhook, VM_JOB_CANCELLED_TEXT, {
                pendingRef,
                notificationType: 'failed',
            })
            await pendingRef
                .update({
                    status: VM_JOB_CANCELLED_STATUS,
                    cancelledAt: Date.now(),
                    runtimeGoldCharged,
                    proxyTokenGoldCharged,
                })
                .catch(() => {})
            await refundVmJob(pendingWebhook, 'VM task stopped')
            return
        }

        if (isVmRuntimeTimeoutError(error)) {
            const timeoutText = buildVmRuntimeTimeoutText(error.runtimeMs || MAX_VM_RUNTIME_MS)
            await writeStatusComment(pendingWebhook, timeoutText, { assistantRunStatus: 'failed' })
            await notifyVmResultChannels(pendingWebhook, timeoutText, {
                pendingRef,
                notificationType: 'failed',
            })
            await pendingRef
                .update({
                    status: 'failed',
                    error: error.message,
                    failureReason: VM_RUNTIME_TIMEOUT_FAILURE_REASON,
                    timedOutAt: Date.now(),
                    runtimeGoldCharged,
                    proxyTokenGoldCharged,
                })
                .catch(() => {})
            await refundVmJob(
                pendingWebhook,
                'VM task exceeded its execution time limit',
                runtimeGoldCharged + proxyTokenGoldCharged
            )
            return
        }

        const message = `The VM task could not be completed: ${error.message}`
        const failureText = `❌ ${message}`
        await writeStatusComment(pendingWebhook, failureText, { assistantRunStatus: 'failed' })
        await notifyVmResultChannels(pendingWebhook, failureText, {
            pendingRef,
            notificationType: 'failed',
        })
        await pendingRef
            .update({
                status: 'failed',
                error: error.message,
                failedAt: Date.now(),
                runtimeGoldCharged,
                proxyTokenGoldCharged,
            })
            .catch(() => {})
        await refundVmJob(pendingWebhook, 'VM task failed during execution', runtimeGoldCharged + proxyTokenGoldCharged)
    } finally {
        heartbeat.stop()
    }
}

module.exports = {
    runVmJobByCorrelationId,
    pauseIdleVmSessions,
    cleanupIdleVmSessions,
    MAX_VM_RUNTIME_MS,
    __private__: {
        buildAgentPrompt,
        GIT_SETUP_SCRIPT,
        buildGitEnv,
        loadGcpContext,
        buildGcpEnv,
        buildCodexProxyConfigOverrides,
        buildCodexRunCommand,
        buildSandboxCommandEnv,
        buildClaudeInstallGuard,
        buildCodexInstallGuard,
        sanitizeVmErrorText,
        buildStageError,
        buildAgentExitError,
        ensureAgentCliAvailable,
        appendClaudeActivity,
        appendCodexActivity,
        renderActivityLog,
        renderVmWorkingHeader,
        resolveAgentRunDetails,
        calculateAccruedRuntimeGold,
        calculateCompletionGoldCharges,
        checkAndChargeVmRuntimeGold,
        refundVmJob,
        VmGoldExhaustedError,
        isVmGoldExhaustedError,
        VmJobCancelledError,
        isVmJobCancelledError,
        isVmJobCancellationRequested,
        startVmCancellationMonitor,
        VmRuntimeTimeoutError,
        isE2bSandboxTimeout,
        isVmRuntimeTimeoutError,
        normalizeVmCommandError,
        selectVmCommandError,
        resolveVmAgentRuntimeMs,
        startVmRuntimeTimeout,
        claimVmJobLease,
        startVmJobHeartbeat,
        formatVmRuntimeDuration,
        buildVmRuntimeTimeoutText,
        buildWhatsAppVmResultMessage,
        isWhatsAppTriggeredVmJob,
        sendWhatsAppVmResultNotification,
        postVmOriginConversationNote,
        notifyVmResultChannels,
        writeStatusComment,
        buildAttachmentTokens,
        buildVmFinalCommentText,
        applyVmCompletionMetadata,
        resolveVmCompletionFollowers,
    },
}
