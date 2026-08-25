/**
 * Turn an uploaded file or a pasted block of text into a skill draft for the
 * Add-skill form (AT-2431).
 *
 * Everything here is pure: it takes bytes/strings and returns a draft plus a
 * list of warnings, and it never touches Firestore, Storage or the redux store.
 * That is what lets the "upload a SKILL.md", "paste markdown" and "upload a zip"
 * entry points share one validation story, and what makes the caps testable
 * without a browser.
 *
 * The caps mirror the server ones the GitHub import already enforces
 * (`functions/Assistant/assistantSkillsImport.js`) and the mount-time caps in
 * `functions/Assistant/assistantSkills.js` — a bundle that passes here must
 * still be mountable in the VM sandbox, or the admin would approve a skill that
 * silently loses files later. Over-cap input is an ERROR, never a silent drop.
 */

import { readSkillArchiveEntries, SkillArchiveError } from '../../../utils/AssistantSkills/skillArchive'
import { isValidSkillName, MAX_SKILL_DESCRIPTION_LENGTH, MAX_SKILL_NAME_LENGTH } from './assistantSkillsHelper'

// SKILL.md body cap — same number the repo import uses.
export const MAX_SKILL_BODY_BYTES = 256 * 1024
// Mount-time caps from functions/Assistant/assistantSkills.js.
export const MAX_SKILL_BUNDLE_FILES = 20
export const MAX_SKILL_BUNDLE_FILE_BYTES = 5 * 1024 * 1024
export const MAX_SKILL_BUNDLE_TOTAL_BYTES = 20 * 1024 * 1024
// The archive itself. Kept above the bundle cap because a zip also carries the
// manifest and headers, but bounded so a stray multi-GB file never reaches the
// decompressor.
export const MAX_SKILL_ARCHIVE_BYTES = 25 * 1024 * 1024

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.txt']
export const ARCHIVE_EXTENSIONS = ['.zip']

export const SKILL_UPLOAD_ACCEPT = [...MARKDOWN_EXTENSIONS, ...ARCHIVE_EXTENSIONS].join(',')

export class SkillSourceError extends Error {
    constructor(code, params = {}) {
        super(code)
        this.name = 'SkillSourceError'
        this.code = code
        this.params = params
    }
}

const BLOCK_SCALAR_INDICATORS = new Set(['>', '|', '>-', '|-', '>+', '|+'])

const KNOWN_FRONTMATTER_KEYS = new Set(['name', 'description', 'display-name', 'displayName'])

const byteLength = text => new TextEncoder().encode(text).length

const getExtension = fileName => {
    const lower = String(fileName || '').toLowerCase()
    const dotIndex = lower.lastIndexOf('.')
    return dotIndex < 0 ? '' : lower.slice(dotIndex)
}

export function classifySkillUploadFile(fileName) {
    const extension = getExtension(fileName)
    if (ARCHIVE_EXTENSIONS.includes(extension)) return 'archive'
    if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown'
    return ''
}

/**
 * Minimal YAML frontmatter reader for the two spec-required fields.
 *
 * Intentionally a port of the server's parser rather than an import of it:
 * Cloud Functions code cannot be imported by app code in this repo (see
 * CLAUDE.md), and the alternative — a callable round trip just to read two
 * strings out of a pasted document — would make the paste box feel remote for
 * no benefit. Keep the two in step when either changes.
 */
export function parseSkillFrontmatter(markdown) {
    const source = typeof markdown === 'string' ? markdown : ''
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!match) return { frontmatter: null, body: source }

    const body = source.slice(match[0].length)
    const frontmatter = {}
    let currentKey = null
    for (const rawLine of match[1].split(/\r?\n/)) {
        const keyMatch = rawLine.match(/^([A-Za-z][\w-]*):\s?(.*)$/)
        if (keyMatch) {
            currentKey = keyMatch[1]
            const value = keyMatch[2].trim()
            // A block scalar indicator introduces the value, it is not the
            // value. Clearing it HERE rather than after the fold is the whole
            // point: once a continuation line has been appended the string is
            // no longer exactly ">", so a later equality check misses it and
            // the indicator ends up prefixed to the description the assistant
            // reads ("> Extract text from PDFs").
            frontmatter[currentKey] = BLOCK_SCALAR_INDICATORS.has(value) ? '' : value
        } else if (currentKey && /^\s+\S/.test(rawLine)) {
            frontmatter[currentKey] = `${frontmatter[currentKey]} ${rawLine.trim()}`.trim()
        }
    }
    for (const key of Object.keys(frontmatter)) {
        const value = frontmatter[key]
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) frontmatter[key] = value.slice(1, -1)
    }
    return { frontmatter, body }
}

export function slugifySkillName(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SKILL_NAME_LENGTH)
        .replace(/-+$/g, '')
}

export function toDisplayName(name) {
    return String(name || '')
        .split('-')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

// "my-skill.md" / "SKILL.md" inside "pdf-processing/" → a usable slug fallback.
function deriveNameFromFileName(fileName) {
    const normalized = String(fileName || '').replace(/\\/g, '/')
    const base = normalized.slice(normalized.lastIndexOf('/') + 1)
    const withoutExtension = base.replace(/\.[^.]+$/, '')
    if (/^skill$/i.test(withoutExtension)) {
        // A bare SKILL.md carries its identity in the folder name, not the file name.
        const segments = normalized.split('/').filter(Boolean)
        const folder = segments.length > 1 ? segments[segments.length - 2] : ''
        return slugifySkillName(folder)
    }
    return slugifySkillName(withoutExtension)
}

/**
 * @returns {{ draft: object, warnings: Array<{ code: string, params?: object }> }}
 */
export function buildSkillDraftFromMarkdown({ markdown, fileName = '', files = [] }) {
    const source = typeof markdown === 'string' ? markdown : ''
    if (!source.trim()) throw new SkillSourceError('emptyContent')
    if (byteLength(source) > MAX_SKILL_BODY_BYTES) {
        throw new SkillSourceError('bodyTooLarge', { limit: Math.round(MAX_SKILL_BODY_BYTES / 1024) })
    }

    const { frontmatter, body } = parseSkillFrontmatter(source)
    const warnings = []
    if (!frontmatter) warnings.push({ code: 'noFrontmatter' })

    const rawName = typeof frontmatter?.name === 'string' ? frontmatter.name.trim() : ''
    let name = ''
    if (isValidSkillName(rawName)) {
        name = rawName
    } else if (rawName) {
        name = slugifySkillName(rawName)
        if (name) warnings.push({ code: 'nameNormalized', params: { name } })
    }
    if (!name) {
        name = deriveNameFromFileName(fileName)
        if (name) warnings.push({ code: 'nameDerived', params: { name } })
    }

    let description = typeof frontmatter?.description === 'string' ? frontmatter.description.trim() : ''
    if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
        description = description.slice(0, MAX_SKILL_DESCRIPTION_LENGTH)
        warnings.push({ code: 'descriptionTruncated', params: { limit: MAX_SKILL_DESCRIPTION_LENGTH } })
    }
    if (!description) warnings.push({ code: 'descriptionMissing' })

    const rawDisplayName =
        typeof frontmatter?.['display-name'] === 'string'
            ? frontmatter['display-name'].trim()
            : typeof frontmatter?.displayName === 'string'
              ? frontmatter.displayName.trim()
              : ''

    // Only these three fields are stored — `buildSkillMarkdown` regenerates the
    // frontmatter from them when the skill is mounted, so anything else in the
    // source document (allowed-tools, license, metadata) is dropped. Say so
    // rather than letting the admin believe their `allowed-tools:` line shipped.
    const droppedKeys = Object.keys(frontmatter || {}).filter(key => !KNOWN_FRONTMATTER_KEYS.has(key))
    if (droppedKeys.length > 0) {
        warnings.push({ code: 'frontmatterFieldsDropped', params: { fields: droppedKeys.join(', ') } })
    }

    return {
        draft: {
            name,
            displayName: rawDisplayName || toDisplayName(name),
            description,
            // Frontmatter is regenerated from the stored fields when the skill is
            // mounted (buildSkillMarkdown), so only the body is kept here —
            // storing it twice would let the two copies disagree after an edit.
            body: frontmatter ? body : source,
            files,
        },
        warnings,
    }
}

function assertSafeRelativePath(relativePath) {
    if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) {
        throw new SkillSourceError('unsafeFilePath', { path: relativePath })
    }
    if (relativePath.split('/').some(segment => segment === '..' || segment === '.' || segment === '')) {
        throw new SkillSourceError('unsafeFilePath', { path: relativePath })
    }
}

/**
 * Pick the single skill out of an archive's entries.
 *
 * One SKILL.md, at the root or one folder down — the shape of every zip a human
 * hands you for "here is my skill". Several manifests means a skill collection,
 * which the repo import already handles properly (staging each one for review),
 * so that is refused here rather than silently importing the first.
 */
export function selectSkillFromArchiveEntries(entries) {
    const manifests = (entries || []).filter(entry => /(^|\/)SKILL\.md$/i.test(entry.path))
    if (manifests.length === 0) throw new SkillSourceError('noManifest')
    if (manifests.length > 1) throw new SkillSourceError('multipleManifests', { count: manifests.length })

    const manifest = manifests[0]
    const separatorIndex = manifest.path.lastIndexOf('/')
    const directoryPrefix = separatorIndex < 0 ? '' : manifest.path.slice(0, separatorIndex + 1)

    const warnings = []
    const files = []
    let totalBytes = 0
    for (const entry of entries) {
        if (entry === manifest) continue
        if (directoryPrefix && !entry.path.startsWith(directoryPrefix)) {
            warnings.push({ code: 'fileOutsideSkillFolder', params: { path: entry.path } })
            continue
        }
        const relativePath = entry.path.slice(directoryPrefix.length)
        assertSafeRelativePath(relativePath)
        if (entry.size > MAX_SKILL_BUNDLE_FILE_BYTES) {
            throw new SkillSourceError('bundleFileTooLarge', {
                path: relativePath,
                limit: Math.round(MAX_SKILL_BUNDLE_FILE_BYTES / (1024 * 1024)),
            })
        }
        totalBytes += entry.size
        files.push({ relativePath, bytes: entry.bytes, size: entry.size })
    }

    if (files.length > MAX_SKILL_BUNDLE_FILES) {
        throw new SkillSourceError('tooManyBundleFiles', { limit: MAX_SKILL_BUNDLE_FILES, count: files.length })
    }
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
        throw new SkillSourceError('bundleTooLarge', {
            limit: Math.round(MAX_SKILL_BUNDLE_TOTAL_BYTES / (1024 * 1024)),
        })
    }

    return { manifest, files, warnings, directoryPrefix }
}

/**
 * Read a picked/dropped file into a draft.
 *
 * The read itself gets its own try/catch so a genuine I/O failure reports as
 * `readFailed` while the typed validation errors raised by the builders below
 * travel to the admin unchanged — wrapping the whole thing would turn "this zip
 * holds three skills" into "could not read the file".
 */
export async function buildSkillDraftFromFile(file) {
    const kind = classifySkillUploadFile(file?.name)
    if (!kind) {
        throw new SkillSourceError('unsupportedFileType', {
            extensions: [...MARKDOWN_EXTENSIONS, ...ARCHIVE_EXTENSIONS].join(', '),
        })
    }

    // Checked BEFORE the read, from the metadata the browser already has. The
    // caps below would catch an over-large file too, but only after
    // `arrayBuffer()` has pulled the whole thing into memory — for a
    // mis-selected multi-gigabyte file that is a dead tab rather than a message.
    const declaredSize = Number(file?.size)
    if (Number.isFinite(declaredSize)) {
        if (kind === 'archive' && declaredSize > MAX_SKILL_ARCHIVE_BYTES) {
            throw new SkillSourceError('archiveTooLarge', {
                limit: Math.round(MAX_SKILL_ARCHIVE_BYTES / (1024 * 1024)),
            })
        }
        if (kind === 'markdown' && declaredSize > MAX_SKILL_BODY_BYTES) {
            throw new SkillSourceError('bodyTooLarge', { limit: Math.round(MAX_SKILL_BODY_BYTES / 1024) })
        }
    }

    let bytes
    try {
        bytes = new Uint8Array(await file.arrayBuffer())
    } catch (error) {
        throw new SkillSourceError('readFailed')
    }

    if (kind === 'archive') return await buildSkillDraftFromArchive({ archive: bytes, fileName: file.name })
    return buildSkillDraftFromMarkdown({
        markdown: new TextDecoder('utf-8').decode(bytes),
        fileName: file.name,
    })
}

// Chunked so a multi-megabyte bundled file cannot blow the argument limit of
// String.fromCharCode (a spread of 5M elements throws RangeError).
export function bytesToBase64(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const CHUNK_SIZE = 0x8000
    let binary = ''
    for (let offset = 0; offset < input.length; offset += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, input.subarray(offset, offset + CHUNK_SIZE))
    }
    return btoa(binary)
}

export async function buildSkillDraftFromArchive({ archive, fileName = '' }) {
    const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive)
    if (bytes.length > MAX_SKILL_ARCHIVE_BYTES) {
        throw new SkillSourceError('archiveTooLarge', { limit: Math.round(MAX_SKILL_ARCHIVE_BYTES / (1024 * 1024)) })
    }

    let entries
    try {
        entries = await readSkillArchiveEntries(bytes)
    } catch (error) {
        if (error instanceof SkillArchiveError) throw new SkillSourceError(error.code, error.params)
        throw new SkillSourceError('invalidArchive')
    }

    const { manifest, files, warnings: selectionWarnings } = selectSkillFromArchiveEntries(entries)
    const markdown = new TextDecoder('utf-8').decode(manifest.bytes)
    const { draft, warnings } = buildSkillDraftFromMarkdown({
        markdown,
        fileName: manifest.path || fileName,
        files,
    })
    return { draft, warnings: [...warnings, ...selectionWarnings] }
}
