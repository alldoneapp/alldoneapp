import ReactQuill from 'react-quill-new'

import { scheduleEmbedContentUnmount } from './embedReactRoot'

const Embed = ReactQuill.Quill.import('blots/embed')

/**
 * The base class for every embed in this app that renders React inside itself.
 *
 * All it adds is the missing half of `renderEmbedContent`: quill 2 gives a blot exactly one
 * teardown hook, `detach()` (parchment calls it from `remove()`, from `ParentBlot.detach()`'s
 * recursion, and from the scroll's removed-node handling), and nothing here was using it — so a
 * React root mounted in `create()` outlived its blot forever. See `scheduleEmbedContentUnmount`
 * for why the unmount is deferred and re-checked rather than run inline.
 *
 * `detach()` is not called when the EDITOR goes away, only when a blot does; a component that
 * owns an editor still has to sweep with `unmountEmbedReactRoots`.
 */
export default class ReactEmbedBlot extends Embed {
    detach() {
        scheduleEmbedContentUnmount(this.domNode, this.scroll?.domNode)
        super.detach()
    }
}
