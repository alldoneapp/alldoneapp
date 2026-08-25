/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Platform, Text, TextInput } from 'react-native'

import EditAssistantSkill from './EditAssistantSkill'
import SkillSourceInput from './SkillSourceInput'
import {
    getNewAssistantSkillId,
    updateAssistantSkill,
    uploadAssistantSkillBundleFile,
    uploadNewAssistantSkill,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'

jest.mock('../../../utils/backends/AssistantSkills/assistantSkillsFirestore', () => ({
    deleteAssistantSkill: jest.fn(),
    getNewAssistantSkillId: jest.fn(() => 'preallocated-skill-id'),
    updateAssistantSkill: jest.fn(),
    uploadAssistantSkillBundleFile: jest.fn(async (skillId, version, relativePath, contentBase64) => ({
        relativePath,
        storagePath: `assistantSkills/${skillId}/${version}/${relativePath}`,
        size: Buffer.from(contentBase64, 'base64').length,
    })),
    uploadNewAssistantSkill: jest.fn(),
}))

jest.mock('../../../redux/store', () => ({
    getState: jest.fn(() => ({ loggedUser: { uid: 'admin-user' }, showShortcuts: false, showFloatPopup: false })),
    subscribe: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key),
}))

jest.mock('../../CheckBox', () => () => null)

// A pressable stub keyed on the title, so a test can press "Save" the way a
// person does rather than reaching into component internals.
jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return function ButtonStub({ title, onPress, disabled }) {
        return React.createElement(
            TouchableOpacity,
            { accessibilityLabel: title, disabled, onPress: disabled ? undefined : onPress },
            React.createElement(Text, null, title)
        )
    }
})

const encode = text => new TextEncoder().encode(text)

const fileFromText = (name, text) => {
    const bytes = encode(text)
    return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

const VALID_MARKDOWN = [
    '---',
    'name: pdf-processing',
    'description: Extract text and tables from PDF files',
    '---',
    '# How to process a PDF',
    '1. Read it',
].join('\n')

const createEditor = (props = {}) => {
    const nodeMocks = []
    const component = renderer.create(<EditAssistantSkill adding={true} onClose={jest.fn()} {...props} />, {
        createNodeMock: element => {
            // react-native-web renders every single-line TextInput as a host
            // `input` too, so key on the file picker's own test id.
            if (element.props?.['data-testid'] !== 'skill-source-file-input') return null
            const node = { click: jest.fn(), value: 'stale' }
            nodeMocks.push(node)
            return node
        },
    })
    return { component, nodeMocks }
}

// Returns whatever the handler returns (a promise for the async ones) and does
// NOT wrap itself in act() — the caller owns the act scope, and a nested one
// makes React warn about overlapping act calls.
const press = (component, title) => {
    const button = component.root
        .findAll(node => node.props?.accessibilityLabel === title && typeof node.props.onPress !== 'undefined')
        .pop()
    if (!button) throw new Error(`No enabled button titled "${title}"`)
    return button.props.onPress()
}

const pressButton = (component, title) => act(() => press(component, title))

const pressButtonAndSettle = async (component, title) => {
    await act(async () => {
        await press(component, title)
    })
}

const buttonIsDisabled = (component, title) =>
    !!component.root.findAll(node => node.props?.accessibilityLabel === title && node.props.disabled === true).length

const uploadFile = async (component, file) => {
    const input = component.root.findByProps({ 'data-testid': 'skill-source-file-input' })
    await act(async () => {
        await input.props.onChange({ target: { files: [file] } })
    })
}

const fieldValues = component => component.root.findAllByType(TextInput).map(node => node.props.value)

const textsWithTestId = (component, testID) =>
    component.root.findAll(node => node.props?.testID === testID).map(node => node.props.children)

describe('EditAssistantSkill — adding from a file or pasted text (AT-2431)', () => {
    const originalPlatform = Platform.OS

    beforeAll(() => {
        Platform.OS = 'web'
    })

    afterAll(() => {
        Platform.OS = originalPlatform
    })

    beforeEach(() => jest.clearAllMocks())

    test('a markdown upload prefills every field and saves as an ordinary skill', async () => {
        const onClose = jest.fn()
        const { component } = createEditor({ onClose })

        expect(buttonIsDisabled(component, 'Save')).toBe(true)

        await uploadFile(component, fileFromText('SKILL.md', VALID_MARKDOWN))

        expect(fieldValues(component)).toEqual(
            expect.arrayContaining([
                'pdf-processing',
                'Pdf Processing',
                'Extract text and tables from PDF files',
                '# How to process a PDF\n1. Read it',
            ])
        )
        expect(buttonIsDisabled(component, 'Save')).toBe(false)

        await pressButtonAndSettle(component, 'Save')

        expect(uploadAssistantSkillBundleFile).not.toHaveBeenCalled()
        expect(uploadNewAssistantSkill).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'pdf-processing',
                displayName: 'Pdf Processing',
                description: 'Extract text and tables from PDF files',
                body: '# How to process a PDF\n1. Read it',
                source: expect.objectContaining({ type: 'upload', fileName: 'SKILL.md' }),
            })
        )
        expect(onClose).toHaveBeenCalled()
    })

    test('pasted text prefills the same way as a file', async () => {
        const { component } = createEditor()

        pressButton(component, 'Paste text')
        const pasteInput = component.root.findByProps({ testID: 'skill-source-paste-input' })
        act(() => pasteInput.props.onChangeText(VALID_MARKDOWN))
        await pressButtonAndSettle(component, 'Use this text')

        expect(fieldValues(component)).toEqual(expect.arrayContaining(['pdf-processing']))
        expect(textsWithTestId(component, 'skill-source-success')).toEqual(['Skill loaded from text'])
    })

    test('parse warnings are surfaced instead of silently guessing', async () => {
        const { component } = createEditor()

        await uploadFile(component, fileFromText('market-research.md', '# Just instructions'))

        const warnings = textsWithTestId(component, 'skill-source-warning').join(' ')
        expect(warnings).toContain('Skill source no frontmatter')
        expect(warnings).toContain('Skill source name derived')
        expect(warnings).toContain('Skill source description missing')
        // Nothing was invented for the description, so the form still blocks Save.
        expect(buttonIsDisabled(component, 'Save')).toBe(true)
    })

    test('an unreadable source reports an error and leaves the form untouched', async () => {
        const { component } = createEditor()

        await uploadFile(component, fileFromText('notes.py', 'print(1)'))

        expect(textsWithTestId(component, 'skill-source-error').join(' ')).toContain('Skill source unsupported file')
        expect(fieldValues(component).filter(Boolean)).toEqual([])
        expect(buttonIsDisabled(component, 'Save')).toBe(true)
    })

    test('the file picker is opened with a cleared value so re-picking the same file still fires', () => {
        const { component, nodeMocks } = createEditor()

        pressButton(component, 'Upload file')

        expect(nodeMocks[0].click).toHaveBeenCalled()
        expect(nodeMocks[0].value).toBe('')
    })

    test('editing an existing skill keeps the original manual flow with no source picker', async () => {
        const component = renderer.create(
            <EditAssistantSkill
                adding={false}
                skill={{ uid: 'skill-1', name: 'a-skill', displayName: 'A', description: 'd', body: 'b', version: 3 }}
                onClose={jest.fn()}
            />
        )

        expect(component.root.findAllByType(SkillSourceInput)).toHaveLength(0)

        await pressButtonAndSettle(component, 'Save')

        expect(updateAssistantSkill).toHaveBeenCalledWith(expect.objectContaining({ uid: 'skill-1', version: 4 }))
    })
})

describe('EditAssistantSkill — uploading a zip bundle (AT-2431)', () => {
    const originalPlatform = Platform.OS
    const { deflateRawSync } = require('zlib')
    const webStreams = require('node:stream/web')

    beforeAll(() => {
        Platform.OS = 'web'
        if (typeof global.DecompressionStream === 'undefined') {
            global.DecompressionStream = webStreams.DecompressionStream
        }
    })

    afterAll(() => {
        Platform.OS = originalPlatform
    })

    beforeEach(() => jest.clearAllMocks())

    function buildZip(files) {
        const encoder = new TextEncoder()
        const parts = []
        const central = []
        let offset = 0
        for (const file of files) {
            const nameBytes = encoder.encode(file.path)
            const contentBytes = encoder.encode(file.content)
            const compressed = new Uint8Array(deflateRawSync(Buffer.from(contentBytes)))
            const localHeader = new Uint8Array(30)
            const localView = new DataView(localHeader.buffer)
            localView.setUint32(0, 0x04034b50, true)
            localView.setUint16(8, 8, true)
            localView.setUint32(18, compressed.length, true)
            localView.setUint32(22, contentBytes.length, true)
            localView.setUint16(26, nameBytes.length, true)
            parts.push(localHeader, nameBytes, compressed)

            const centralHeader = new Uint8Array(46)
            const centralView = new DataView(centralHeader.buffer)
            centralView.setUint32(0, 0x02014b50, true)
            centralView.setUint16(10, 8, true)
            centralView.setUint32(20, compressed.length, true)
            centralView.setUint32(24, contentBytes.length, true)
            centralView.setUint16(28, nameBytes.length, true)
            centralView.setUint32(42, offset, true)
            central.push(centralHeader, nameBytes)
            offset += localHeader.length + nameBytes.length + compressed.length
        }
        const centralSize = central.reduce((total, part) => total + part.length, 0)
        const eocd = new Uint8Array(22)
        const eocdView = new DataView(eocd.buffer)
        eocdView.setUint32(0, 0x06054b50, true)
        eocdView.setUint16(8, files.length, true)
        eocdView.setUint16(10, files.length, true)
        eocdView.setUint32(12, centralSize, true)
        eocdView.setUint32(16, offset, true)
        const all = [...parts, ...central, eocd]
        const output = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
        let cursor = 0
        for (const part of all) {
            output.set(part, cursor)
            cursor += part.length
        }
        return output
    }

    const zipFile = () => {
        const bytes = buildZip([
            { path: 'pdf-processing/SKILL.md', content: VALID_MARKDOWN },
            { path: 'pdf-processing/scripts/run.py', content: 'print("extract")' },
        ])
        return {
            name: 'pdf-processing.zip',
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        }
    }

    test('bundled files are uploaded only on Save, under the id the skill is stored at', async () => {
        const onClose = jest.fn()
        const { component } = createEditor({ onClose })

        await uploadFile(component, zipFile())

        // Nothing has been written yet — cancelling here must leave no orphans.
        expect(uploadAssistantSkillBundleFile).not.toHaveBeenCalled()
        expect(component.root.findAll(node => node.props?.testID === 'skill-bundle-summary')).toHaveLength(1)

        await pressButtonAndSettle(component, 'Save')

        expect(getNewAssistantSkillId).toHaveBeenCalled()
        expect(uploadAssistantSkillBundleFile).toHaveBeenCalledTimes(1)
        expect(uploadAssistantSkillBundleFile).toHaveBeenCalledWith(
            'preallocated-skill-id',
            1,
            'scripts/run.py',
            Buffer.from('print("extract")').toString('base64')
        )
        expect(uploadNewAssistantSkill).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: 'preallocated-skill-id',
                version: 1,
                files: [
                    {
                        relativePath: 'scripts/run.py',
                        storagePath: 'assistantSkills/preallocated-skill-id/1/scripts/run.py',
                        size: 16,
                    },
                ],
            })
        )
        expect(onClose).toHaveBeenCalled()
    })

    test('a bundle marks the skill VM-only before it is ever saved', async () => {
        const { component } = createEditor()

        await uploadFile(component, zipFile())

        const labels = component.root.findAllByType(Text).map(node => node.props.children)
        expect(labels).toContain('VM only')
        expect(labels).toContain('VM only skill hint')
    })

    // Regression: `draft.name || currentSkill.name` kept the FIRST source's name
    // and description while the body and bundle came from the second, producing
    // a savable skill named after a file the admin had replaced.
    test('a second source replaces the first draft completely', async () => {
        const { component } = createEditor()

        await uploadFile(component, zipFile())
        await uploadFile(component, fileFromText('notes.md', '# Only instructions'))

        expect(fieldValues(component)).not.toContain('pdf-processing')
        expect(fieldValues(component)).not.toContain('Extract text and tables from PDF files')
        expect(fieldValues(component)).toContain('# Only instructions')
        expect(component.root.findAll(node => node.props?.testID === 'skill-bundle-summary')).toHaveLength(0)
    })

    test('retrying a failed Save reuses the skill id and re-uploads only what is missing', async () => {
        // First attempt: file 1 stores, the document write fails.
        uploadNewAssistantSkill.mockRejectedValueOnce(new Error('firestore unavailable'))
        const { component } = createEditor()

        await uploadFile(component, zipFile())
        await pressButtonAndSettle(component, 'Save')

        expect(uploadAssistantSkillBundleFile).toHaveBeenCalledTimes(1)
        const firstSkillId = uploadAssistantSkillBundleFile.mock.calls[0][0]

        await pressButtonAndSettle(component, 'Save')

        // The already-stored file is not sent again, and the skill lands at the
        // id its files were written under — re-allocating would orphan a full
        // copy of the bundle under a document that never existed.
        expect(uploadAssistantSkillBundleFile).toHaveBeenCalledTimes(1)
        expect(uploadNewAssistantSkill).toHaveBeenLastCalledWith(expect.objectContaining({ uid: firstSkillId }))
    })

    test('a failed bundle upload keeps the form open and explains itself', async () => {
        uploadAssistantSkillBundleFile.mockRejectedValueOnce(new Error('storage unavailable'))
        const onClose = jest.fn()
        const { component } = createEditor({ onClose })

        await uploadFile(component, zipFile())
        await pressButtonAndSettle(component, 'Save')

        expect(onClose).not.toHaveBeenCalled()
        expect(uploadNewAssistantSkill).not.toHaveBeenCalled()
        expect(textsWithTestId(component, 'skill-save-error').join(' ')).toContain('storage unavailable')
    })
})
