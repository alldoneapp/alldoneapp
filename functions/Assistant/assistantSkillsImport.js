const admin = require('firebase-admin')

const { isValidSkillName } = require('./assistantSkills')

const MAX_SKILLS_PER_IMPORT = 60
const MAX_BODY_BYTES = 256 * 1024 // SKILL.md body cap per spec recommendation (<5k tokens) with headroom
const MAX_BUNDLED_FILE_BYTES = 5 * 1024 * 1024
const MAX_BUNDLED_TOTAL_BYTES_PER_SKILL = 20 * 1024 * 1024

function parseRepoUrl(repoUrl) {
    if (typeof repoUrl !== 'string') return null
    const trimmed = repoUrl.trim().replace(/\.git$/, '')
    // Accept "owner/repo" shorthand or a full github.com URL.
    const shorthand = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
    if (shorthand) return { owner: shorthand[1], repo: shorthand[2] }
    const url = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/)
    if (url) return { owner: url[1], repo: url[2] }
    return null
}

async function githubJson(path, githubToken) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'alldone-skill-import' }
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`
    const response = await fetch(`https://api.github.com${path}`, { headers })
    if (!response.ok) throw new Error(`GitHub API ${path} failed: ${response.status}`)
    return await response.json()
}

async function fetchRaw(owner, repo, sha, filePath) {
    const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${filePath
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
        { headers: { 'User-Agent': 'alldone-skill-import' } }
    )
    if (!response.ok) throw new Error(`Fetching ${filePath} failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
}

// Minimal YAML frontmatter parser for the two spec-required fields. Handles
// plain and quoted single-line values plus indented continuation lines.
function parseSkillFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!match) return { frontmatter: null, body: markdown }
    const body = markdown.slice(match[0].length)
    const frontmatter = {}
    let currentKey = null
    for (const rawLine of match[1].split(/\r?\n/)) {
        const keyMatch = rawLine.match(/^([A-Za-z][\w-]*):\s?(.*)$/)
        if (keyMatch) {
            currentKey = keyMatch[1]
            frontmatter[currentKey] = keyMatch[2].trim()
        } else if (currentKey && /^\s+\S/.test(rawLine)) {
            // Continuation of a folded multi-line value.
            frontmatter[currentKey] = `${frontmatter[currentKey]} ${rawLine.trim()}`.trim()
        }
    }
    for (const key of Object.keys(frontmatter)) {
        const value = frontmatter[key]
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) frontmatter[key] = value.slice(1, -1)
        else if (value === '>' || value === '|' || value === '>-' || value === '|-') frontmatter[key] = ''
    }
    return { frontmatter, body }
}

function toDisplayName(name) {
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

async function requireAdministrator(userId) {
    const roleDoc = await admin.firestore().doc('roles/administrator').get()
    const adminUserId = roleDoc.exists ? roleDoc.data().userId : null
    if (!adminUserId || adminUserId !== userId) {
        const error = new Error('Only the administrator can import skills')
        error.code = 'permission-denied'
        throw error
    }
}

// Fetches a GitHub repo at a pinned commit, finds every */SKILL.md, and stages
// one assistantSkillImports doc per skill for admin review. Bundled files are
// uploaded to Storage immediately under the proposed skill id so approving is
// a pure Firestore write.
// Skills are processed in parallel (and bundled files within a skill too) —
// the import is network-bound on GitHub fetches, so this is the main speedup.
const SKILL_CONCURRENCY = 5
const FILE_CONCURRENCY = 4

const JOB_ID_REGEX = /^[A-Za-z0-9_-]{6,64}$/

// Live progress for the admin UI: one doc per import run that the client
// watches while the callable is still running. Server-only writes.
function getImportJobRef(jobId) {
    if (typeof jobId !== 'string' || !JOB_ID_REGEX.test(jobId)) return null
    return admin.firestore().doc(`assistantSkillImportJobs/${jobId}`)
}

async function importAssistantSkillsFromRepo({ userId, repoUrl, ref, githubToken, jobId }) {
    const jobRef = getImportJobRef(jobId)
    const updateJob = async data => {
        if (!jobRef) return
        try {
            await jobRef.set({ ...data, updatedAt: Date.now() }, { merge: true })
        } catch (error) {
            console.warn('🧩 SKILL IMPORT: progress update failed', { jobId, error: error.message })
        }
    }

    try {
        await requireAdministrator(userId)

        const parsed = parseRepoUrl(repoUrl)
        if (!parsed) throw new Error('Could not parse the repository URL. Use "owner/repo" or a github.com URL.')
        const { owner, repo } = parsed

        await updateJob({
            status: 'running',
            repoUrl: `https://github.com/${owner}/${repo}`,
            createdBy: userId,
            startedAt: Date.now(),
            processed: 0,
            total: null,
            stagedCount: 0,
            skippedCount: 0,
            currentSkill: '',
        })

        const repoInfo = await githubJson(`/repos/${owner}/${repo}`, githubToken)
        const resolvedRef = (typeof ref === 'string' && ref.trim()) || repoInfo.default_branch
        const commit = await githubJson(
            `/repos/${owner}/${repo}/commits/${encodeURIComponent(resolvedRef)}`,
            githubToken
        )
        const sha = commit.sha

        const tree = await githubJson(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, githubToken)
        const blobs = (tree.tree || []).filter(node => node.type === 'blob')
        const skillManifests = blobs.filter(node => /(^|\/)SKILL\.md$/.test(node.path)).slice(0, MAX_SKILLS_PER_IMPORT)

        if (skillManifests.length === 0) throw new Error('No SKILL.md files found in this repository.')

        await updateJob({ total: skillManifests.length, sha, ref: resolvedRef })

        const db = admin.firestore()
        const bucket = admin.storage().bucket()
        const batchId = db.collection('assistantSkillImports').doc().id
        const importedAt = Date.now()
        const staged = []
        const skipped = []
        let processed = 0

        const processManifest = async manifest => {
            const dirPath = manifest.path.replace(/SKILL\.md$/, '').replace(/\/$/, '')
            try {
                const markdown = (await fetchRaw(owner, repo, sha, manifest.path)).toString('utf8')
                if (Buffer.byteLength(markdown) > MAX_BODY_BYTES) {
                    skipped.push({ path: manifest.path, reason: 'SKILL.md too large' })
                    return dirPath
                }
                const { frontmatter, body } = parseSkillFrontmatter(markdown)
                const name = frontmatter?.name
                const description = frontmatter?.description
                if (!isValidSkillName(name) || !description) {
                    skipped.push({ path: manifest.path, reason: 'Missing or invalid name/description frontmatter' })
                    return dirPath
                }

                const proposedSkillId = db.collection(`assistantSkills/globalProject/items`).doc().id
                const bundledBlobs = dirPath
                    ? blobs.filter(node => node.path.startsWith(`${dirPath}/`) && node.path !== manifest.path)
                    : []

                // Sizes come from the git tree, so caps are applied before any
                // download — that keeps them deterministic with parallel fetches.
                const eligibleFiles = []
                let totalBytes = 0
                for (const blob of bundledBlobs) {
                    const relativePath = blob.path.slice(dirPath.length + 1)
                    const size = Number(blob.size) || 0
                    if (size > MAX_BUNDLED_FILE_BYTES || totalBytes + size > MAX_BUNDLED_TOTAL_BYTES_PER_SKILL) {
                        skipped.push({ path: blob.path, reason: 'Bundled file over size cap' })
                        continue
                    }
                    totalBytes += size
                    eligibleFiles.push({ blobPath: blob.path, relativePath })
                }

                const files = []
                let nextFileIndex = 0
                const fileWorkers = Array.from(
                    { length: Math.min(FILE_CONCURRENCY, eligibleFiles.length) },
                    async () => {
                        while (nextFileIndex < eligibleFiles.length) {
                            const { blobPath, relativePath } = eligibleFiles[nextFileIndex++]
                            const content = await fetchRaw(owner, repo, sha, blobPath)
                            const storagePath = `assistantSkills/${proposedSkillId}/1/${relativePath}`
                            await bucket.file(storagePath).save(content)
                            files.push({ relativePath, storagePath, size: content.length })
                        }
                    }
                )
                await Promise.all(fileWorkers)

                const stagedDoc = {
                    batchId,
                    status: 'pendingReview',
                    proposedSkillId,
                    name,
                    displayName: toDisplayName(name),
                    description: String(description).slice(0, 1024),
                    body,
                    files,
                    source: {
                        type: 'import',
                        repoUrl: `https://github.com/${owner}/${repo}`,
                        ref: resolvedRef,
                        sha,
                        path: manifest.path,
                        importedAt,
                    },
                    importedBy: userId,
                    importedAt,
                }
                await db.collection('assistantSkillImports').add(stagedDoc)
                staged.push({ name, fileCount: files.length })
                return name
            } catch (error) {
                console.warn('🧩 SKILL IMPORT: failed for manifest', { path: manifest.path, error: error.message })
                skipped.push({ path: manifest.path, reason: error.message })
                return dirPath
            }
        }

        let nextManifestIndex = 0
        const skillWorkers = Array.from({ length: Math.min(SKILL_CONCURRENCY, skillManifests.length) }, async () => {
            while (nextManifestIndex < skillManifests.length) {
                const manifest = skillManifests[nextManifestIndex++]
                const skillName = await processManifest(manifest)
                processed++
                await updateJob({
                    processed,
                    currentSkill: skillName || manifest.path,
                    stagedCount: staged.length,
                    skippedCount: skipped.length,
                })
            }
        })
        await Promise.all(skillWorkers)

        await updateJob({
            status: 'done',
            finishedAt: Date.now(),
            processed,
            stagedCount: staged.length,
            skippedCount: skipped.length,
            currentSkill: '',
        })

        console.log('🧩 SKILL IMPORT: completed', {
            repo: `${owner}/${repo}`,
            sha,
            stagedCount: staged.length,
            skippedCount: skipped.length,
        })
        return { batchId, sha, ref: resolvedRef, staged, skipped }
    } catch (error) {
        await updateJob({ status: 'error', error: error.message, finishedAt: Date.now() })
        throw error
    }
}

module.exports = { importAssistantSkillsFromRepo, parseRepoUrl, parseSkillFrontmatter }
