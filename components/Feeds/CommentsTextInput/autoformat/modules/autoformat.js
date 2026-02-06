import ReactQuill from 'react-quill'
import v4 from 'uuid/v4'

import { formatUrl, getUrlObject } from '../../../../../utils/LinkingHelper'
import {
    checkIfInputHaveKarma,
    getPlaceholderData,
    NEW_ATTACHMENT,
    processPastedText,
    QUILL_EDITOR_TEXT_INPUT_TYPE,
} from '../../textInputHelper'
import store from '../../../../../redux/store'
import { tryToextractPeopleForMention, REGEX_URL } from '../../../Utils/HelperFunctions'
import { loadQuill } from '../../../../NotesView/NotesDV/EditorView/mentionsHelper'
import { checkIsLimitedByTraffic } from '../../../../Premium/PremiumHelper'

const Module = ReactQuill.Quill.import('core/module')
const Delta = ReactQuill.Quill.import('delta')
const { Attributor, Scope } = ReactQuill.Quill.import('parchment')

// Binds autoformat transforms to typing and pasting
class Autoformat extends Module {
    constructor(quill, options) {
        super(quill, options)
        this.transforms = options

        const {
            editorType,
            editorId,
            keyboardType,
            singleLine,
            userIdAllowedToEditTags,
            disabledEnterKey,
        } = getPlaceholderData(quill.options.placeholder)

        this.editorId = editorId
        this.isTextInputType = editorType === QUILL_EDITOR_TEXT_INPUT_TYPE
        this.singleLine = singleLine
        this.userIdAllowedToEditTags = userIdAllowedToEditTags
        this.disabledEnterKey = disabledEnterKey

        if (this.isTextInputType) {
            delete quill.keyboard.bindings[13]
        } else {
            loadQuill(quill)
        }

        if (quill.options.formats.length > 0) {
            this.registerTypeListener()

            if (this.isTextInputType) {
                this.registerTextInputTextPasteListener()
                this.registerTextInputElementPasteListener()
            }
        } else {
            if (this.isTextInputType && keyboardType === 'numeric') {
                this.registerNumericTextInputTextPasteListener()
            }
        }
    }

    registerTextInputElementPasteListener() {
        this.quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
            if (delta && delta.ops && delta.ops[0] && delta.ops[0].insert) {
                const projectId = store.getState().quillEditorProjectId
                const { attributes } = delta.ops[0]
                const isFomatedLink = attributes && attributes.link && REGEX_URL.test(attributes.link)
                const {
                    hashtag,
                    email,
                    mention,
                    image,
                    url,
                    customImageFormat,
                    attachment,
                    karma,
                } = delta.ops[0].insert
                if (hashtag) {
                    hashtag.id = v4()
                } else if (email) {
                    email.id = v4()
                } else if (url) {
                    url.id = v4()
                } else if (mention) {
                    mention.id = v4()
                } else if (karma) {
                    const hasKarma = checkIfInputHaveKarma(this.quill)
                    hasKarma ? (delta.ops[0].insert = '') : (karma.id = v4())
                } else if (attachment) {
                    if (checkIsLimitedByTraffic(projectId)) {
                        delta.ops[0].insert = ''
                    } else {
                        attachment.isNew = NEW_ATTACHMENT
                        attachment.id = v4()
                    }
                } else if (customImageFormat) {
                    if (checkIsLimitedByTraffic(projectId)) {
                        delta.ops[0].insert = ''
                    } else {
                        customImageFormat.isNew = NEW_ATTACHMENT
                        customImageFormat.id = v4()
                    }
                } else if (image) {
                    if (checkIsLimitedByTraffic(projectId)) {
                        delta.ops[0].insert = ''
                    } else {
                        const customImageFormat = {
                            text: 'image.jpg',
                            uri: image,
                            resizedUri: image,
                            isNew: NEW_ATTACHMENT,
                            editorId: this.editorId,
                        }
                        delta.ops[0].insert = ' '
                        delta.ops.push({ insert: { customImageFormat } })
                        delta.ops.push({ insert: ' ' })
                    }
                } else if (isFomatedLink) {
                    const urlToProcess = attributes.link

                    const people = tryToextractPeopleForMention(projectId, urlToProcess)
                    if (people) {
                        const { peopleName, uid } = people
                        const id = v4()
                        const mention = {
                            text: peopleName,
                            id,
                            userId: uid,
                            editorId: this.editorId,
                            userIdAllowedToEditTags: this.userIdAllowedToEditTags,
                        }
                        delta.ops[0].insert = ' '
                        delta.ops.push({ insert: { mention } })
                        delta.ops.push({ insert: ' ' })
                    } else {
                        const execRes = formatUrl(urlToProcess)
                        if (execRes) {
                            const url = getUrlObject(
                                urlToProcess,
                                execRes,
                                projectId,
                                this.editorId,
                                this.userIdAllowedToEditTags
                            )

                            delta.ops[0].insert = ' '
                            delta.ops.push({ insert: { url } })
                            delta.ops.push({ insert: ' ' })
                        }
                    }
                } else if (this.singleLine || this.disabledEnterKey) {
                    delta.ops[0].insert = delta.ops[0].insert.replace(/(\r\n|\n|\r)/gm, '')
                }
            }
            return delta
        })
    }

    registerTextInputTextPasteListener() {
        this.quill.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
            if (delta.ops.length > 0) {
                if (this.singleLine || this.disabledEnterKey) {
                    delta.ops[0].insert = delta.ops[0].insert.replace(/(\r\n|\n|\r)/gm, '')
                }

                const { insert, attributes } = delta.ops[0]
                const projectId = store.getState().quillEditorProjectId
                const parsedDelta = processPastedText(
                    insert,
                    Delta,
                    projectId,
                    this.editorId,
                    this.userIdAllowedToEditTags,
                    false,
                    '',
                    this.quill,
                    false,
                    attributes,
                    true
                )
                return parsedDelta
            }
            return delta
        })
    }

    registerNumericTextInputTextPasteListener() {
        this.quill.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
            if (this.singleLine || this.disabledEnterKey) {
                delta.ops[0].insert = delta.ops[0].insert.replace(/(\r\n|\n|\r)/gm, '')
            }
            delta.ops[0].insert = delta.ops[0].insert.replace(/\D/g, '')
            return delta
        })
    }

    registerTypeListener() {
        this.quill.keyboard.addBinding(
            {
                key: 38, // Arrow Up
                collapsed: true,
                format: ['autoformat-helper'],
            },
            this.forwardKeyboardUp.bind(this)
        )

        this.quill.keyboard.addBinding(
            {
                key: 40, // Arrow Down
                collapsed: true,
                format: ['autoformat-helper'],
            },
            this.forwardKeyboardDown.bind(this)
        )

        this.quill.on(ReactQuill.Quill.events.EDITOR_CHANGE, (type, range) => {
            if (type === ReactQuill.Quill.events.SELECTION_CHANGE) {
                let formats = range == null ? {} : this.quill.getFormat(range)

                const setValue = (property = 'color') => {
                    if (formats.hasOwnProperty(property)) {
                        let colorLabel = document.querySelector(`.ql-${property} .ql-color-label`)
                        let value = formats[property]
                        if (colorLabel) {
                            if (colorLabel.tagName === 'line') {
                                colorLabel.style.stroke = value
                            } else {
                                colorLabel.style.fill = value
                            }
                        }
                    }
                }

                setValue('color')
                setValue('background')
            }
        })

        this.quill.on(ReactQuill.Quill.events.TEXT_CHANGE, (delta, oldDelta, source) => {
            let ops = delta.ops
            if (source !== 'user' || !ops || ops.length < 1) {
                return
            }

            // Check last insert
            let lastOpIndex = ops.length - 1
            let lastOp = ops[lastOpIndex]

            while (!lastOp.insert && lastOpIndex > 0) {
                lastOpIndex--
                lastOp = ops[lastOpIndex]
            }

            if (!lastOp.insert || typeof lastOp.insert !== 'string') {
                return
            }
            let isEnter = lastOp.insert === '\n'

            // Get selection
            let sel = this.quill.getSelection()
            if (!sel) {
                return
            }
            let endSelIndex = this.quill.getLength() - sel.index - (isEnter ? 1 : 0)

            // Get leaf
            let checkIndex = sel.index
            let [leaf] = this.quill.getLeaf(checkIndex)

            if (!leaf || !leaf.text) {
                return
            }

            let leafIndex = leaf.offset(leaf.scroll)
            let leafSelIndex = checkIndex - leafIndex

            // let transformed = false

            // Check transforms
            for (const name in this.transforms) {
                const transform = this.transforms[name]

                // Check helper trigger
                if (transform.helper && transform.helper.trigger) {
                    if (lastOp.insert.match(transform.helper.trigger)) {
                        // TODO: check leaf/atindex instead
                        this.quill.formatText(checkIndex, 1, 'autoformat-helper', name, ReactQuill.Quill.sources.API)
                        this.openHelper(transform, checkIndex)
                        continue
                    }
                }

                // Check transform trigger
                if (lastOp.insert.match(transform.trigger || /./)) {
                    this.closeHelper(transform)

                    let ops = new Delta().retain(leafIndex)
                    let transformOps = makeTransformedDelta(
                        this.quill,
                        transform,
                        leaf.text,
                        leafSelIndex,
                        this.editorId,
                        this.userIdAllowedToEditTags
                    )

                    if (transformOps) {
                        ops = ops.concat(transformOps)
                    }

                    const isNewLine = !!lastOp.insert.match(/[\r?\n]/)

                    this.quill.updateContents(ops, 'user')
                    removeSpaceAtStart(this.quill)
                    if (isNewLine) {
                        setTimeout(() => {
                            this.quill.setSelection(this.quill.getLength() - endSelIndex, 'user')
                        })
                    }
                    // transformed = true
                }
            }

            // Restore cursor position
            // if (transformed) {
            //     setTimeout(() => {
            //         this.quill.setSelection(this.quill.getLength() - endSelIndex, 'api')
            //     }, 0)
            // }
        })
    }

    forwardKeyboard(range, context) {
        if (this.currentHelper && this.currentHelper.container) {
            let target = this.currentHelper.container.querySelector('.dropdown-menu')
            target.dispatchEvent(context.event)
        }
    }

    forwardKeyboardUp(range, context) {
        var e = new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            keyCode: 38,
            which: 38,
            bubbles: true,
            cancelable: true,
        })
        context.event = e
        this.forwardKeyboard(range, context)
    }

    forwardKeyboardDown(range, context) {
        var e = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true,
            cancelable: true,
        })
        context.event = e
        this.forwardKeyboard(range, context)
    }

    openHelper(transform, index) {
        if (transform.helper) {
            this.currentHelper = transform.helper
            if (typeof transform.helper.open === 'function') {
                let pos = this.quill.getBounds(index)
                let helperNode = this.quill.addContainer('ql-helper')
                helperNode.style.position = 'absolute'
                helperNode.style.top = pos.top + 'px'
                helperNode.style.left = pos.left + 'px'
                helperNode.style.width = pos.width + 'px'
                helperNode.style.height = pos.height + 'px'

                transform.helper.container = helperNode
                transform.helper.open(helperNode)
            }
        }
    }

    closeHelper(transform) {
        if (transform.helper) {
            if (typeof transform.helper.close === 'function') {
                transform.helper.close(transform.helper.container)
            }
        }
    }
}

function getFormat(transform, match) {
    let format = {}

    if (typeof transform.format === 'string') {
        format[transform.format] = match
    } else if (typeof transform.format === 'object') {
        format = transform.format
    }

    return format
}

function transformMatch(transform, match) {
    let find = new RegExp(transform.extract || transform.find)
    return transform.transform ? match.replace(find, transform.transform) : match
}

function applyExtract(transform, match) {
    // Extract
    if (transform.extract) {
        let extract = new RegExp(transform.extract)
        let extractMatch = extract.exec(match[0])

        if (!extractMatch || !extractMatch.length) {
            return match
        }

        extractMatch.index += match.index
        return extractMatch
    }

    return match
}

function makeTransformedDelta(quillInstance, transform, text, atIndex, editorId, userIdAllowedToEditTags) {
    if (!transform.find.global) {
        transform.find = new RegExp(transform.find, transform.find.flags + 'g')
    }
    transform.find.lastIndex = 0

    let ops = new Delta()
    let findResult = null
    let checkAtIndex = atIndex !== undefined && atIndex !== null

    if (checkAtIndex) {
        // find match at index
        findResult = transform.find.exec(text)

        while (findResult && findResult.length && findResult.index < atIndex) {
            if (findResult.index < atIndex && findResult.index + findResult[0].length + 1 >= atIndex) {
                ops = ops.concat(
                    transformedMatchOps(
                        quillInstance,
                        atIndex,
                        transform,
                        findResult,
                        editorId,
                        userIdAllowedToEditTags
                    ).ops
                )
                break
            } else {
                findResult = transform.find.exec(text)
            }
        }
    } else {
        // find all matches
        while ((findResult = transform.find.exec(text)) !== null) {
            let transformedMatch = transformedMatchOps(
                quillInstance,
                atIndex,
                transform,
                findResult,
                editorId,
                userIdAllowedToEditTags
            )
            ops = ops.concat(transformedMatch.ops)
            text = text.substr(transformedMatch.rightIndex)
            transform.find.lastIndex = 0
        }
    }

    return ops
}

function transformedMatchOps(quillInstance, atIndex, transform, result, editorId, userIdAllowedToEditTags) {
    result = applyExtract(transform, result)

    let resultIndex = result.index
    let transformedMatch = transformMatch(transform, result[0])

    let insert = transformedMatch

    if (transform.insert) {
        insert = {}
        insert[transform.insert] = transformedMatch
    }

    let format = getFormat(transform, transformedMatch)

    const ops = new Delta()

    if (transform.insert === 'url') {
        const projectId = store.getState().quillEditorProjectId
        const people = tryToextractPeopleForMention(projectId, transformedMatch)
        if (people) {
            const { peopleName, uid } = people
            transformedMatchForMentionsOps(ops, result, resultIndex, peopleName, uid, editorId, userIdAllowedToEditTags)
        } else {
            let execRes = formatUrl(transformedMatch)
            if (execRes) {
                const url = getUrlObject(transformedMatch, execRes, projectId, editorId, userIdAllowedToEditTags)

                ops.retain(resultIndex)
                insertSpaceAtStart(quillInstance, ops, atIndex, result)

                const { type, objectId, url: objectUrl } = url
                const isObjectNoteUrl = objectUrl && objectUrl.endsWith('/note')
                if (type === 'task' && !isObjectNoteUrl) {
                    const taskTagFormat = { id: v4(), taskId: objectId, editorId, objectUrl }
                    ops.insert({
                        taskTagFormat,
                    })
                } else {
                    ops.insert({
                        url,
                    })
                }

                ops.delete(result[0].length)
            }
        }
    } else if (transform.insert === 'hashtag') {
        const id = v4()
        const hashtag = { text: transformedMatch, id, editorId, userIdAllowedToEditTags }
        ops.retain(resultIndex)
        insertSpaceAtStart(quillInstance, ops, atIndex, result)
        ops.insert({ hashtag })
        ops.delete(result[0].length)
    } else if (transform.insert === 'email') {
        const id = v4()
        const email = { text: transformedMatch, id, editorId, userIdAllowedToEditTags }
        ops.retain(resultIndex)
        insertSpaceAtStart(quillInstance, ops, atIndex, result)
        ops.insert({ email })
        ops.delete(result[0].length)
    } else {
        ops.retain(resultIndex).delete(result[0].length).insert(insert, format)
    }

    let rightIndex = resultIndex + result[0].length

    return {
        ops,
        rightIndex,
    }
}

function isTextInputEditor(quillInstance) {
    const { editorType } = getPlaceholderData(quillInstance.options.placeholder)
    return editorType === QUILL_EDITOR_TEXT_INPUT_TYPE
}

function insertSpaceAtStart(quillInstance, ops, atIndex, result) {
    if (atIndex - result[0].length <= 1) {
        ops.insert(' ')
        quillInstance.hasStartSpace = isTextInputEditor(quillInstance)
    }
}

function removeSpaceAtStart(quillInstance) {
    if (quillInstance && quillInstance.hasStartSpace && isTextInputEditor(quillInstance)) {
        const selectedText = quillInstance.getText(0, 1)
        if (selectedText === ' ') {
            let ops = new Delta()
            ops.delete(1)
            quillInstance.updateContents(ops, 'user')
            quillInstance.setSelection(2, 'user')
            delete quillInstance.hasStartSpace
        }
    }
}

function transformedMatchForMentionsOps(ops, result, resultIndex, text, userId, editorId, userIdAllowedToEditTags) {
    const id = v4()
    const mention = { text, id, userId, editorId, userIdAllowedToEditTags }
    ops.retain(resultIndex)
    ops.insert({ mention })
    ops.delete(result[0].length)
}

// TRANSFORM {
//   trigger:     RegExp for matching text input characters to trigger the match. Defaults to /./ which is matching any character
//   find:        Global RegExp to search for in the text
//   extract:     Additional RegExp to finetune and override the found text match
//   transform:   String or function passed to String.replace() to rewrite find/extract results
//   insert:      Insert name string or embed insert object.
//   format:      Format name string or attributes object.
// }

// Reference:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace
// https://github.com/quilljs/delta/#insert

Autoformat.DEFAULTS = {
    hashtag: {
        trigger: /[\s.,;:!?]/,
        find: /(?:^|\s)#[^\s.,;:!?]+/i,
        extract: /#([^\s.,;:!?]+)/i,
        transform: '$1',
        insert: 'hashtag',
    },

    link: {
        trigger: /[\s\r?\n]/,
        find: /((https?|ftp):\/\/[\S]+|(www\.[\S]+))|([\S]+\.[a-zA-Z]{2,}[\S]*)/gi,
        insert: 'url',
    },
    email: {
        trigger: /[\s.,;:!?]/,
        find: /\S+@\S+\.\S+/i,
        extract: /^\S+@\S+$/i,
        insert: 'email',
    },
}

const AutoformatHelperAttribute = new Attributor.Style('autoformat-helper', 'data-helper', { scope: Scope.INLINE })

export { Autoformat as default, AutoformatHelperAttribute }
