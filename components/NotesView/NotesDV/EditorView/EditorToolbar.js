import React, { useEffect, useRef, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { firebase } from '@firebase/app'
import { Quill } from 'react-quill'
import moment from 'moment'
import v4 from 'uuid/v4'
import { getDateFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import styles, { colors } from '../../../styles/global'
import QuillCursors from 'quill-cursors'
// import { ImageDrop } from 'quill-image-drop-module'
import DragAndDropModule from 'quill-drag-and-drop-module'
import EditorsGroup from './EditorsGroup/EditorsGroup'
import { useSelector } from 'react-redux'
// import 'quill-paste-smart'
import Hashtag from '../../../Feeds/CommentsTextInput/autoformat/formats/hashtag'
import CommentTagFormat from '../../../Feeds/CommentsTextInput/autoformat/formats/commentTagFormat'
import Attachment from '../../../Feeds/CommentsTextInput/autoformat/formats/attachment'
import CustomImageFormat from '../../../Feeds/CommentsTextInput/autoformat/formats/customImageFormat'
import Mention from '../../../Feeds/CommentsTextInput/autoformat/formats/mention'
import Url from '../../../Feeds/CommentsTextInput/autoformat/formats/url'
import Email from '../../../Feeds/CommentsTextInput/autoformat/formats/email'
import Karma from '../../../Feeds/CommentsTextInput/autoformat/formats/karma'
import VideoFormat from '../../../Feeds/CommentsTextInput/autoformat/formats/videoFormat'
import TaskTagFormat from '../../../Feeds/CommentsTextInput/autoformat/formats/taskTagFormat'
import Autoformat, { AutoformatHelperAttribute } from '../../../Feeds/CommentsTextInput/autoformat/modules/autoformat'
import domServer from 'react-dom/server'
import dom from 'react-dom'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { uniqBy } from 'lodash'
import { exportRef, loadedNote } from './NotesEditorView'
import Icon from '../../../Icon'
import { shortcutNotePreviewMount, shortcutNotePreviewUnmount } from '../../../../utils/HelperFunctions'
import NotesAttachmentsSelectorModal from '../../../UIComponents/FloatModals/NotesAttachmentsSelectorModal'
import {
    ATTACHMENTS_SELECTOR_MODAL_ID,
    getPlaceholderData,
    insertAttachmentInsideEditor,
    LOADING_MODE,
    beforeUndoRedo,
    NOT_USER_MENTIONED,
} from '../../../Feeds/CommentsTextInput/textInputHelper'
import store from '../../../../redux/store'
import { setQuotedNoteText, storeOpenModal, setShowLimitedFeatureModal } from '../../../../redux/actions'
import {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    MENTION_SPACE_CODE,
    updateNewAttachmentsDataInNotes,
    VIDEO_TRIGGER,
} from '../../../Feeds/Utils/HelperFunctions'
import { getDvChatTabLink, getDvMainTabLink, getUrlObject } from '../../../../utils/LinkingHelper'
import { BACKGROUND_COLORS, TEXT_COLORS } from '../../../../utils/ColorConstants'
import MilestoneTag from '../../../Feeds/CommentsTextInput/autoformat/formats/milestoneTag'
import { translate } from '../../../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import { quillTextInputProjectIds } from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../utils/NavigationService'

const Delta = Quill.import('delta')

//region SVGs
export const BoldIcon = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 6,3 C 5.4477381,3.0000552 5.0000552,3.4477381 5,4 v 16 c 5.52e-5,0.552262 0.4477381,0.999945 1,1 h 9 c 2.749579,0 5,-2.250421 5,-5 0,-1.878071 -1.06175,-3.503178 -2.603516,-4.357422 C 18.376282,10.728209 19,9.4373694 19,8 19,5.2504209 16.749579,3 14,3 Z m 1,2 h 7 c 1.668699,0 3,1.3313011 3,3 0,1.6686989 -1.331301,3 -3,3 H 7 Z m 0,8 h 7 1 c 1.668699,0 3,1.331301 3,3 0,1.668699 -1.331301,3 -3,3 H 7 Z"
</svg>
`

export const UnderlineIcon = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 5.984375 1.9863281 A 1.0001 1.0001 0 0 0 5 3 L 5 10 C 5 13.854149 8.1458514 17 12 17 C 15.854149 17 19 13.854149 19 10 L 19 3 A 1.0001 1.0001 0 1 0 17 3 L 17 10 C 17 12.773268 14.773268 15 12 15 C 9.2267316 15 7 12.773268 7 10 L 7 3 A 1.0001 1.0001 0 0 0 5.984375 1.9863281 z M 4 20 A 1.0001 1.0001 0 1 0 4 22 L 20 22 A 1.0001 1.0001 0 1 0 20 20 L 4 20 z "/>
</svg>
`

export const ItalicsIcon = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 10 3 A 1.0001 1.0001 0 1 0 10 5 L 13.558594 5 L 8.3085938 19 L 5 19 A 1.0001 1.0001 0 1 0 5 21 L 14 21 A 1.0001 1.0001 0 1 0 14 19 L 10.441406 19 L 15.691406 5 L 19 5 A 1.0001 1.0001 0 1 0 19 3 L 10 3 z "
</svg>
`

export const CrossoutIcon = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 12.027344 3 C 8.7914193 3 6 5.2764783 6 8.2714844 C 6 8.7488632 6.0728539 9.2139867 6.2089844 9.6542969 A 1.0001 1.0001 0 1 0 8.1191406 9.0644531 C 8.0404911 8.8100633 8 8.5460456 8 8.2714844 C 8 6.5489104 9.7095677 5 12.027344 5 C 13.910095 5 15.422007 6.0648849 15.890625 7.34375 A 1.0001 1.0001 0 1 0 17.767578 6.65625 C 16.962396 4.4588951 14.655992 3 12.027344 3 z M 20.966797 8.9960938 A 1.0001 1.0001 0 0 0 20.951172 8.9980469 A 1.0001 1.0001 0 0 0 20.783203 9.0234375 L 2.7832031 13.023438 A 1.0003371 1.0003371 0 1 0 3.2167969 14.976562 L 12.076172 13.007812 C 14.375298 13.072566 16 14.511321 16 16 C 16 17.522727 14.299968 19 11.919922 19 C 9.9118431 19 8.344564 17.892915 7.9511719 16.689453 C 7.5371094 15.421224 5.6347656 16.042318 6.0488281 17.310547 C 6.783316 19.557485 9.1937804 21 11.919922 21 C 15.151076 21 18 18.895473 18 16 C 18 14.408654 17.122513 13.073419 15.810547 12.177734 L 21.216797 10.976562 A 1.0001 1.0001 0 0 0 20.966797 8.9960938 z "
</svg>
`

export const TextColor = `
<svg viewbox="-4 -4 36 36">
  <line class="ql-color-label" stroke-width="4" x1=0 x2=24 y1=28 y2=28></line>
  <path
    class="ql-stroke ql-fill"
    d="M 12.007812 3 A 1.0001 1.0001 0 0 0 11.105469 3.5527344 L 3.1054688 19.552734 A 1.0001165 1.0001165 0 1 0 4.8945312 20.447266 L 7.1171875 16 L 16.882812 16 L 19.105469 20.447266 A 1.0001163 1.0001163 0 1 0 20.894531 19.552734 L 12.894531 3.5527344 A 1.0001 1.0001 0 0 0 12.007812 3 z M 12 6.2363281 L 15.882812 14 L 8.1171875 14 L 12 6.2363281 z "
</svg>
`

export const HighlightColor = `
<svg viewbox="-4 -4 36 36">
  <line class="ql-color-label" stroke-width="4" x1=0 x2=24 y1=28 y2=28></line>
    <path
       class="ql-stroke ql-fill"   
       d="M 18.833984 2.1738281 C 18.064069 2.1738281 17.292428 2.4634316 16.710938 3.0449219 L 8.9101562 10.845703 C 7.4111858 10.641083 5.8371429 11.092545 4.6914062 12.238281 C 4.0874936 12.842194 3.7561946 13.62732 3.4609375 14.498047 C 3.1656805 15.368774 2.9405709 16.329283 2.7675781 17.232422 C 2.4215927 19.0387 2.28125 20.632812 2.28125 20.632812 L 2.1738281 21.826172 L 3.3671875 21.71875 C 3.3671875 21.71875 4.9612999 21.578407 6.7675781 21.232422 C 7.6707169 21.059429 8.6312266 20.83432 9.5019531 20.539062 C 10.37268 20.243806 11.157806 19.912506 11.761719 19.308594 C 12.907455 18.162857 13.358917 16.588814 13.154297 15.089844 L 20.955078 7.2890625 C 22.118059 6.1260819 22.118059 4.2079025 20.955078 3.0449219 C 20.373588 2.4634316 19.603899 2.1738281 18.833984 2.1738281 z M 18.833984 4.15625 C 19.086546 4.15625 19.339032 4.2570004 19.541016 4.4589844 C 19.944984 4.8629524 19.944984 5.471032 19.541016 5.875 L 12.398438 13.017578 C 12.216497 12.741522 12.004086 12.480648 11.761719 12.238281 C 11.519352 11.995914 11.258478 11.783503 10.982422 11.601562 L 18.125 4.4589844 C 18.326984 4.2570004 18.581423 4.15625 18.833984 4.15625 z M 8.2265625 12.767578 C 8.9922356 12.767578 9.7576821 13.06237 10.347656 13.652344 C 11.527605 14.832292 11.527605 16.714583 10.347656 17.894531 C 10.17052 18.071667 9.5935021 18.397547 8.859375 18.646484 C 8.1252473 18.895421 7.2367677 19.10355 6.390625 19.265625 C 5.367943 19.461515 5.0523122 19.47469 4.4550781 19.544922 C 4.5253097 18.947688 4.5384846 18.632057 4.734375 17.609375 C 4.8964502 16.763233 5.1045785 15.874752 5.3535156 15.140625 C 5.6024527 14.406498 5.9283328 13.82948 6.1054688 13.652344 C 6.6954429 13.06237 7.4608894 12.767578 8.2265625 12.767578 z "
</svg>
`

export const CleanFormat = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 3 3 C 2.4477381 3.0000552 2.0000552 3.4477381 2 4 L 2 7 C 1.9808748 8.3523227 4.0191252 8.3523227 4 7 L 4 5 L 10 5 L 10 19 L 9 19 C 7.6476773 18.98088 7.6476773 21.019125 9 21 L 13 21 C 14.352323 21.01912 14.352323 18.980875 13 19 L 12 19 L 12 5 L 18 5 L 18 7 C 17.98088 8.3523227 20.019125 8.3523227 20 7 L 20 4 C 19.999945 3.4477381 19.552262 3.0000552 19 3 L 3 3 z M 15.990234 13.990234 C 15.092817 13.99047 14.649857 15.08112 15.292969 15.707031 L 17.085938 17.5 L 15.292969 19.292969 C 14.311289 20.235477 15.764523 21.688711 16.707031 20.707031 L 18.5 18.914062 L 20.292969 20.707031 C 21.235477 21.688711 22.688711 20.235477 21.707031 19.292969 L 19.914062 17.5 L 21.707031 15.707031 C 22.361134 15.071216 21.892274 13.963344 20.980469 13.990234 C 20.72067 13.997934 20.474091 14.106555 20.292969 14.292969 L 18.5 16.085938 L 16.707031 14.292969 C 16.51876 14.099436 16.260236 13.99025 15.990234 13.990234 z "
</svg>
`

export const Link = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 16.697266 0.98828125 C 15.355676 1.0440204 13.962688 1.6032697 12.775391 2.75 A 1.0001 1.0001 0 0 0 12.765625 2.7617188 L 11.044922 4.4707031 A 1.0001 1.0001 0 1 0 12.455078 5.8886719 L 14.164062 4.1894531 L 14.169922 4.1855469 C 15.167388 3.2247985 16.170764 2.9268814 17.136719 2.9902344 C 18.104573 3.0537124 19.054004 3.5208013 19.771484 4.2382812 C 20.488964 4.9557613 20.956054 5.9051922 21.019531 6.8730469 C 21.082881 7.8390016 20.784967 8.8423774 19.824219 9.8398438 C 19.822319 9.8418038 19.822213 9.8437431 19.820312 9.8457031 L 16.832031 12.832031 A 1.0001 1.0001 0 0 0 16.832031 12.833984 C 15.096605 14.57004 12.271099 14.366035 10.800781 12.400391 A 1.0003906 1.0003906 0 1 0 9.1992188 13.599609 C 11.377498 16.511717 15.677009 16.818064 18.248047 14.246094 L 21.248047 11.248047 A 1.0001 1.0001 0 0 0 21.259766 11.234375 C 22.570301 9.8774175 23.11471 8.2529565 23.015625 6.7421875 C 22.91654 5.2314185 22.215439 3.8541111 21.185547 2.8242188 C 20.155654 1.7943262 18.778347 1.0932257 17.267578 0.99414062 C 17.078732 0.98175499 16.888921 0.98031852 16.697266 0.98828125 z M 9.796875 8.0078125 C 8.3328054 8.0540446 6.8767823 8.6286692 5.7519531 9.7539062 L 2.7519531 12.751953 A 1.0001 1.0001 0 0 0 2.7402344 12.765625 C 1.4296855 14.122536 0.88528994 15.747045 0.984375 17.257812 C 1.0834601 18.768581 1.7845607 20.145889 2.8144531 21.175781 C 3.8443456 22.205674 5.2216529 22.906774 6.7324219 23.005859 C 8.2431908 23.104939 9.8676983 22.560549 11.224609 21.25 A 1.0001 1.0001 0 0 0 11.236328 21.236328 L 12.947266 19.527344 A 1.0001 1.0001 0 1 0 11.533203 18.113281 L 9.8300781 19.814453 C 8.8326119 20.775202 7.8292359 21.073119 6.8632812 21.009766 C 5.8954267 20.946288 4.9459957 20.479199 4.2285156 19.761719 C 3.5110355 19.044239 3.0439462 18.094808 2.9804688 17.126953 C 2.9171157 16.160998 3.2150328 15.157622 4.1757812 14.160156 C 4.1776713 14.158156 4.1777875 14.156297 4.1796875 14.154297 L 7.1679688 11.167969 A 1.0001 1.0001 0 0 0 7.1679688 11.166016 C 8.9033948 9.4299598 11.728901 9.6339653 13.199219 11.599609 A 1.0003905 1.0003905 0 1 0 14.800781 10.400391 C 13.711639 8.9444245 12.092163 8.1390141 10.423828 8.0195312 C 10.215286 8.0045959 10.006028 8.0012079 9.796875 8.0078125 z "
</svg>
`

export const ListBulleted = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 4 4 A 2 2 0 0 0 2 6 A 2 2 0 0 0 4 8 A 2 2 0 0 0 6 6 A 2 2 0 0 0 4 4 z M 9 5 A 1.0001 1.0001 0 1 0 9 7 L 21 7 A 1.0001 1.0001 0 1 0 21 5 L 9 5 z M 4 10 A 2 2 0 0 0 2 12 A 2 2 0 0 0 4 14 A 2 2 0 0 0 6 12 A 2 2 0 0 0 4 10 z M 9 11 A 1.0001 1.0001 0 1 0 9 13 L 21 13 A 1.0001 1.0001 0 1 0 21 11 L 9 11 z M 4 16 A 2 2 0 0 0 2 18 A 2 2 0 0 0 4 20 A 2 2 0 0 0 6 18 A 2 2 0 0 0 4 16 z M 9 17 A 1.0001 1.0001 0 1 0 9 19 L 21 19 A 1.0001 1.0001 0 1 0 21 17 L 9 17 z "
</svg>
`

export const ListNumbered = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 4.9082031 4 L 3 4.6074219 L 3 5.3105469 L 3.9902344 5.0449219 L 3.9902344 8 L 5 8 L 5 4 L 4.9082031 4 z M 9 5 A 1.0001 1.0001 0 1 0 9 7 L 21 7 A 1.0001 1.0001 0 1 0 21 5 L 9 5 z M 4.4882812 10 C 4.2072113 10 3.9540925 10.058328 3.7265625 10.173828 C 3.4990325 10.289428 3.3195162 10.45045 3.1914062 10.65625 C 3.0632963 10.86025 3 11.082319 3 11.324219 L 3.96875 11.324219 C 3.96875 11.147319 4.0156519 11.000113 4.1074219 10.882812 C 4.1992019 10.763613 4.3176238 10.703125 4.4648438 10.703125 C 4.6139837 10.703125 4.7282506 10.747537 4.8066406 10.835938 C 4.8850406 10.924437 4.9238281 11.054909 4.9238281 11.224609 C 4.9238281 11.434009 4.7585144 11.716566 4.4277344 12.072266 L 3.0859375 13.404297 L 3.0859375 14 L 6 14 L 6 13.296875 L 4.3574219 13.296875 L 4.8964844 12.708984 C 5.1832944 12.438184 5.3894781 12.221247 5.5175781 12.060547 C 5.6475981 11.898047 5.7435075 11.743956 5.8046875 11.597656 C 5.8658775 11.449656 5.8964844 11.297778 5.8964844 11.142578 C 5.8964844 10.774178 5.7740369 10.491722 5.5292969 10.294922 C 5.2864669 10.098122 4.9395213 10 4.4882812 10 z M 9 11 A 1.0001 1.0001 0 1 0 9 13 L 21 13 A 1.0001 1.0001 0 1 0 21 11 L 9 11 z M 4.4570312 16 C 4.1999413 16 3.9635469 16.045819 3.7480469 16.136719 C 3.5344369 16.225719 3.3670737 16.349366 3.2460938 16.509766 C 3.1251138 16.670066 3.0644531 16.853794 3.0644531 17.058594 L 4.0214844 17.058594 C 4.0214844 16.955294 4.0675262 16.868328 4.1601562 16.798828 C 4.2546662 16.729428 4.3655375 16.695312 4.4921875 16.695312 C 4.6471975 16.695312 4.7664925 16.736459 4.8515625 16.818359 C 4.9366225 16.898559 4.9785156 17.002559 4.9785156 17.130859 C 4.9785156 17.460359 4.8006394 17.625 4.4433594 17.625 L 3.9921875 17.625 L 3.9921875 18.294922 L 4.4570312 18.294922 C 4.6403913 18.294922 4.7847019 18.335969 4.8886719 18.417969 C 4.9926419 18.499869 5.0449219 18.640037 5.0449219 18.835938 C 5.0449219 18.973137 4.9947212 19.084828 4.8945312 19.173828 C 4.7943413 19.261128 4.6604375 19.304688 4.4921875 19.304688 C 4.3428475 19.304688 4.2173144 19.261128 4.1152344 19.173828 C 4.0131544 19.086628 3.9609375 18.984534 3.9609375 18.865234 L 3 18.865234 C 3 19.084334 3.0586444 19.280325 3.1777344 19.453125 C 3.2968244 19.624125 3.472505 19.757469 3.703125 19.855469 C 3.935645 19.951669 4.1867113 20 4.4570312 20 C 4.9182713 20 5.2906688 19.8959 5.5742188 19.6875 C 5.8577687 19.4791 6 19.200916 6 18.853516 C 6 18.629116 5.93727 18.440462 5.8125 18.289062 C 5.68774 18.135863 5.516155 18.022066 5.296875 17.947266 C 5.504815 17.854666 5.6617812 17.735691 5.7695312 17.587891 C 5.8791712 17.438191 5.9355469 17.278728 5.9355469 17.111328 C 5.9355469 16.765728 5.8037756 16.494575 5.5410156 16.296875 C 5.2782556 16.099175 4.9163813 16 4.4570312 16 z M 9 17 A 1.0001 1.0001 0 1 0 9 19 L 21 19 A 1.0001 1.0001 0 1 0 21 17 L 9 17 z "
</svg>
`

export const Image = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 5 2 C 3.3552972 2 2 3.3552972 2 5 L 2 19 C 2 20.644703 3.3552972 22 5 22 L 19 22 C 20.644703 22 22 20.644703 22 19 L 22 5 C 22 3.3552972 20.644703 2 19 2 L 5 2 z M 5 4 L 19 4 C 19.571297 4 20 4.4287028 20 5 L 20 12.585938 L 16.707031 9.2929688 C 16.515708 9.1015569 16.254978 8.9958557 15.984375 9 C 15.724601 9.00414 15.476635 9.1092126 15.292969 9.2929688 L 4.6523438 19.933594 C 4.2657921 19.797594 4 19.446088 4 19 L 4 5 C 4 4.4287028 4.4287028 4 5 4 z M 8.5 6 C 7.1311328 6 6 7.1311328 6 8.5 C 6 9.8688672 7.1311328 11 8.5 11 C 9.8688672 11 11 9.8688672 11 8.5 C 11 7.1311328 9.8688672 6 8.5 6 z M 8.5 8 C 8.787987 8 9 8.212013 9 8.5 C 9 8.787987 8.787987 9 8.5 9 C 8.212013 9 8 8.787987 8 8.5 C 8 8.212013 8.212013 8 8.5 8 z M 16 11.414062 L 20 15.414062 L 20 19 C 20 19.571297 19.571297 20 19 20 L 7.4140625 20 L 16 11.414062 z "
</svg>
`

export const File = `
<svg viewBox="0 0 24 24">
  <path
     class="ql-stroke ql-fill"
     d="M 4 2 C 2.3549904 2 1 3.3549904 1 5 L 1 19 C 1 20.64501 2.3549904 22 4 22 L 20 22 C 21.64501 22 23 20.64501 23 19 L 23 8 C 23 6.3549904 21.64501 5 20 5 L 11.535156 5 L 9.8320312 2.4453125 A 1.0001 1.0001 0 0 0 9 2 L 4 2 z M 4 4 L 8.4648438 4 L 10.167969 6.5546875 A 1.0001 1.0001 0 0 0 11 7 L 20 7 C 20.564129 7 21 7.4358706 21 8 L 21 19 C 21 19.564129 20.564129 20 20 20 L 4 20 C 3.4358706 20 3 19.564129 3 19 L 3 5 C 3 4.4358706 3.4358706 4 4 4 z M 11.984375 9.9863281 A 1.0001 1.0001 0 0 0 11 11 L 11 13 L 9 13 A 1.0001 1.0001 0 1 0 9 15 L 11 15 L 11 17 A 1.0001 1.0001 0 1 0 13 17 L 13 15 L 15 15 A 1.0001 1.0001 0 1 0 15 13 L 13 13 L 13 11 A 1.0001 1.0001 0 0 0 11.984375 9.9863281 z "
</svg>
`

const Comment = () => (
    <svg viewBox="0 0 24 24">
        <path
            className="ql-stroke ql-fill"
            d="M 12.5,2 C 11.024786,1.9964611 9.5709729,2.3413759 8.2539062,3.0058594 5.0383094,4.612962 3.0021345,7.903323 3,11.498047 c -0.00344,1.31802 0.3115515,2.604705 0.84375,3.806641 l -1.7929688,5.378906 a 1.0001,1.0001 0 0 0 1.265625,1.265625 L 8.6953125,20.15625 C 9.8972484,20.688448 11.183933,21.003436 12.501953,21 c 3.593254,-0.0021 6.882413,-2.036683 8.490235,-5.25 v -0.002 C 21.657708,14.429806 22.00385,12.974771 22,11.498047 V 11 a 1.0001,1.0001 0 0 0 -0.002,-0.05469 C 21.732326,6.1288378 17.871162,2.2676741 13.054688,2.0019531 A 1.0001,1.0001 0 0 0 13,2 h -0.498047 z m -0.002,2 A 1.0001,1.0001 0 0 0 12.5,4 h 0.453125 C 16.761562,4.2142779 19.785722,7.2384381 20,11.046875 V 11.5 a 1.0001,1.0001 0 0 0 0,0.002 c 0.003,1.162396 -0.268897,2.310101 -0.792969,3.347656 a 1.0001,1.0001 0 0 0 -0.002,0.0039 C 17.934393,17.395986 15.342323,18.9989 12.5,19 a 1.0001,1.0001 0 0 0 -0.002,0 c -1.162396,0.003 -2.310101,-0.268897 -3.3476564,-0.792969 A 1.0001,1.0001 0 0 0 8.3828125,18.150391 L 4.5820312,19.417969 5.8496094,15.617188 A 1.0001,1.0001 0 0 0 5.7929688,14.849609 C 5.268897,13.812054 4.9969693,12.664349 5,11.501953 A 1.0001,1.0001 0 0 0 5,11.5 c 0.0011,-2.8423226 1.6040135,-5.4343928 4.1464844,-6.7050781 a 1.0001,1.0001 0 0 0 0.00391,-0.00195 C 10.187946,4.268897 11.335651,3.9969693 12.498047,4 Z"
        />
    </svg>
)

const Task = () => (
    <svg viewBox="0 0 24 24">
        <path
            className="ql-stroke ql-fill"
            d="M 4.9980469 2 C 3.3538269 2 2 3.3543569 2 4.9980469 L 2 18.986328 C 2 20.630028 3.3538269 21.984375 4.9980469 21.984375 L 13 21.984375 C 13.552 21.984375 14 21.536275 14 20.984375 C 14 20.432575 13.552 19.986328 13 19.986328 L 4.9980469 19.986328 C 4.4343169 19.986328 4 19.549928 4 18.986328 L 4 4.9980469 C 4 4.4344969 4.4343169 3.9980469 4.9980469 3.9980469 L 16.007812 3.9980469 C 16.559613 3.9980469 17.007812 3.55156 17.007812 3 C 17.007812 2.44843 16.559613 2 16.007812 2 L 4.9980469 2 z M 21.970703 2.9882812 C 21.700803 2.9962712 21.458103 3.1111656 21.283203 3.2910156 L 11.996094 12.578125 L 9.703125 10.287109 C 9.521215 10.097309 9.2652919 9.9804688 8.9824219 9.9804688 C 8.4306919 9.9804687 7.9824219 10.426916 7.9824219 10.978516 C 7.9824219 11.261316 8.1001525 11.517319 8.2890625 11.699219 L 11.289062 14.697266 C 11.469963 14.878166 11.720294 14.990234 11.996094 14.990234 C 12.271994 14.990234 12.520272 14.878166 12.701172 14.697266 L 22.697266 4.7050781 C 22.884266 4.5232281 23 4.2690613 23 3.9882812 C 23 3.4367212 22.5517 2.9882812 22 2.9882812 L 21.970703 2.9882812 z M 20.990234 8.9941406 C 20.438134 8.9941406 19.992188 9.4422906 19.992188 9.9941406 L 20 13 C 20 13.5518 20.448 14 21 14 C 21.552 14 21.998047 13.5518 21.998047 13 L 21.990234 9.9941406 C 21.990234 9.4422906 21.542234 8.9941406 20.990234 8.9941406 z M 19 15 C 18.4477 15 18 15.4477 18 16 L 18 18 L 16 18 C 15.4477 18 15 18.4477 15 19 C 15 19.5523 15.4477 20 16 20 L 18 20 L 18 22 C 18 22.5523 18.4477 23 19 23 C 19.5523 23 20 22.5523 20 22 L 20 20 L 22 20 C 22.5523 20 23 19.5523 23 19 C 23 18.4477 22.5523 18 22 18 L 20 18 L 20 16 C 20 15.4477 19.5523 15 19 15 z "
        />
    </svg>
)

const TextFormat = () => (
    <svg viewBox="0 0 24 24">
        <path
            className="ql-stroke ql-fill"
            d="M 4 2 C 3.56957 2 3.1869012 2.2752537 3.0507812 2.6835938 L 2.0507812 5.6835938 C 1.8761412 6.2075438 2.1596538 6.7745787 2.6835938 6.9492188 C 3.2075337 7.1238687 3.7745687 6.8403463 3.9492188 6.3164062 L 4.7207031 4 L 9.6289062 4 L 5.7714844 16 L 4 16 C 3.44771 16 3 16.4477 3 17 C 3 17.5523 3.44771 18 4 18 L 9 18 C 9.55228 18 10 17.5523 10 17 C 10 16.4477 9.55228 16 9 16 L 7.8710938 16 L 11.728516 4 L 16.613281 4 L 16.050781 5.6835938 C 15.876181 6.2075438 16.159694 6.7745787 16.683594 6.9492188 C 17.207494 7.1238687 17.774619 6.8403463 17.949219 6.3164062 L 18.949219 3.3164062 C 19.050919 3.0114563 18.998447 2.6767856 18.810547 2.4160156 C 18.622547 2.1552456 18.3215 2 18 2 L 4 2 z M 19 10 C 19 10 18.366641 10.634472 17.681641 11.513672 C 16.876341 12.547272 16 13.9192 16 15 C 16 16.6569 17.3431 18 19 18 C 20.6569 18 22 16.6569 22 15 C 22 13.9192 21.123659 12.547272 20.318359 11.513672 C 19.633359 10.634472 19 10 19 10 z M 19 13.085938 C 19.2938 13.488338 19.554787 13.894731 19.742188 14.269531 C 19.966787 14.718831 20 14.9532 20 15 C 20 15.5523 19.5523 16 19 16 C 18.4477 16 18 15.5523 18 15 C 18 14.9532 18.033213 14.718831 18.257812 14.269531 C 18.445212 13.894731 18.7062 13.488338 19 13.085938 z M 4 20 C 3.44772 20 3 20.4477 3 21 C 3 21.5523 3.44772 22 4 22 L 20 22 C 20.5523 22 21 21.5523 21 21 C 21 20.4477 20.5523 20 20 20 L 4 20 z "
        />
    </svg>
)

const Timestamp = () => (
    <svg viewBox="0 0 24 24">
        <path
            className="ql-stroke ql-fill"
            d="M 12 1 C 8.1458514 1 5 4.1458514 5 8 C 5 10.767206 6.6529103 13.106632 8.9980469 14.240234 L 9 16 L 5 16 C 4.1666667 16 3.4501036 16.385834 2.9179688 16.917969 C 2.3858339 17.450104 2 18.166667 2 19 L 2 22 C 2.0000552 22.552262 2.4477381 22.999945 3 23 L 21 23 C 21.552262 22.999945 21.999945 22.552262 22 22 L 22 19 C 22 18.166667 21.614166 17.450104 21.082031 16.917969 C 20.549896 16.385834 19.833333 16 19 16 L 15 16 L 15 14.242188 C 17.345891 13.109682 19 10.768581 19 8 C 19 4.1458513 15.854148 1 12 1 z M 12 3 C 14.773268 3 17 5.2267317 17 8 C 17 10.186524 15.60465 12.030547 13.666016 12.714844 C 13.266555 12.856417 12.999699 13.234397 13 13.658203 L 13 16 C 13 16.593967 13.272667 17.070243 13.621094 17.410156 C 13.969521 17.75007 14.424435 18 15 18 L 19 18 C 19.166667 18 19.450104 18.114166 19.667969 18.332031 C 19.885834 18.549896 20 18.833333 20 19 L 20 21 L 4 21 L 4 19 C 4 18.833333 4.1141661 18.549896 4.3320312 18.332031 C 4.5498964 18.114166 4.8333333 18 5 18 L 9 18 C 9.5755647 18 10.030387 17.750086 10.378906 17.410156 C 10.727425 17.070226 11.000377 16.594376 11 16 L 10.998047 13.65625 C 10.997528 13.233172 10.730798 12.856193 10.332031 12.714844 C 8.3928757 12.029014 7 10.185438 7 8 C 7 5.2267316 9.2267316 3 12 3 z M 11.984375 4.9863281 C 11.432859 4.9949492 10.992447 5.4484682 11 6 L 11 8 C 11.000051 8.265199 11.105433 8.5195196 11.292969 8.7070312 L 13.292969 10.707031 C 14.235477 11.688704 15.688704 10.235477 14.707031 9.2929688 L 13 7.5859375 L 13 6 C 13.00772 5.4362301 12.548129 4.9775228 11.984375 4.9863281 z "
        />
    </svg>
)

const CustomUndo = () => (
    <svg viewBox="0 0 18 18">
        <polygon className="ql-fill ql-stroke" points="6 10 4 12 2 10 6 10" />
        <path className="ql-stroke" d="M8.09,13.91A4.6,4.6,0,0,0,9,14,5,5,0,1,0,4,9" />
    </svg>
)

const CustomRedo = () => (
    <svg viewBox="0 0 18 18">
        <polygon className="ql-fill ql-stroke" points="12 10 14 12 16 10 12 10" />
        <path className="ql-stroke" d="M9.91,13.91A4.6,4.6,0,0,1,9,14a5,5,0,1,1,5-5" />
    </svg>
)

const TextStyleNormal = ({ style, className }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <path
            style={style}
            className="ql-stroke ql-fill"
            d="M 8 3 C 7.58316 3 7.2108231 3.2581275 7.0644531 3.6484375 L 1.0644531 19.648438 C 0.87053512 20.165537 1.1313175 20.741647 1.6484375 20.935547 C 2.1655575 21.129447 2.74358 20.868662 2.9375 20.351562 L 4.5683594 16 L 11.431641 16 L 13.064453 20.351562 C 13.258453 20.868663 13.834462 21.129447 14.351562 20.935547 C 14.868662 20.741647 15.1314 20.165537 14.9375 19.648438 L 8.9375 3.6484375 C 8.79114 3.2581275 8.41685 3 8 3 z M 8 6.8476562 L 10.681641 14 L 5.3183594 14 L 8 6.8476562 z M 19 11 C 18.0071 11 17.2895 11.335997 16.8125 11.716797 C 16.5803 11.902097 16.415234 12.090534 16.302734 12.240234 C 16.246334 12.315234 16.201922 12.382947 16.169922 12.435547 C 16.147422 12.472647 16.124969 12.510128 16.105469 12.548828 C 15.858469 13.041628 16.058734 13.642272 16.552734 13.888672 C 17.037934 14.130772 17.626059 13.940797 17.880859 13.466797 C 17.883959 13.461997 17.891644 13.4517 17.902344 13.4375 C 17.930544 13.4 17.9822 13.339491 18.0625 13.275391 C 18.2105 13.157291 18.493 12.996094 19 12.996094 C 19.5095 12.996094 19.705722 13.152966 19.794922 13.259766 C 19.910822 13.398566 20 13.641587 20 13.992188 L 20 14.824219 C 19.2569 14.776219 18.516034 14.858406 17.865234 15.128906 C 17.342934 15.346006 16.863278 15.692266 16.517578 16.197266 C 16.170178 16.704866 16 17.313575 16 17.984375 C 16 18.816575 16.254687 19.534666 16.742188 20.072266 C 17.222188 20.601666 17.858175 20.877597 18.484375 20.966797 C 19.198075 21.068597 19.98115 20.936578 20.65625 20.580078 C 21.02275 20.863078 21.4988 20.976562 22 20.976562 C 22.5523 20.976562 23 20.529516 23 19.978516 C 23 19.427516 22.5523 18.980469 22 18.980469 L 22 13.992188 C 22 13.345187 21.839078 12.591922 21.330078 11.982422 C 20.794278 11.340922 19.9905 11 19 11 z M 20 16.824219 L 20 18.621094 C 19.6991 18.894694 19.215525 19.056387 18.765625 18.992188 C 18.516825 18.956788 18.340263 18.857822 18.226562 18.732422 C 18.120363 18.615322 18 18.399275 18 17.984375 C 18 17.657575 18.079922 17.453766 18.169922 17.322266 C 18.261822 17.188066 18.407166 17.067256 18.634766 16.972656 C 18.971966 16.832456 19.4457 16.772219 20 16.824219 z "
        />
    </svg>
)

const TextStyleH1 = ({ style, className }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <path
            style={style}
            className="ql-stroke ql-fill"
            d="M 2 2 C 1.44772 2 1 2.44772 1 3 L 1 21 C 1 21.5523 1.44772 22 2 22 C 2.55228 22 3 21.5523 3 21 L 3 13 L 12 13 L 12 21 C 12 21.5523 12.4477 22 13 22 C 13.5523 22 14 21.5523 14 21 L 14 3 C 14 2.44772 13.5523 2 13 2 C 12.4477 2 12 2.44772 12 3 L 12 11 L 3 11 L 3 3 C 3 2.44772 2.55228 2 2 2 z M 20.095703 11.089844 C 19.803677 11.062019 19.507469 11.164406 19.292969 11.378906 L 17.292969 13.378906 C 16.902469 13.769406 16.902469 14.402469 17.292969 14.792969 C 17.683469 15.183469 18.316531 15.183469 18.707031 14.792969 L 19 14.5 L 19 20 L 18 20 C 17.4477 20 17 20.4477 17 21 C 17 21.5523 17.4477 22 18 22 L 22 22 C 22.5523 22 23 21.5523 23 21 C 23 20.4477 22.5523 20 22 20 L 21 20 L 21 12.085938 C 21 11.681437 20.756512 11.316909 20.382812 11.162109 C 20.289388 11.123409 20.193045 11.099119 20.095703 11.089844 z "
        />
    </svg>
)

const TextStyleH2 = ({ style, className }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <path
            style={style}
            className="ql-stroke ql-fill"
            d="M 2 2 C 1.44772 2 1 2.44772 1 3 L 1 21 C 1 21.5523 1.44772 22 2 22 C 2.55228 22 3 21.5523 3 21 L 3 13 L 12 13 L 12 21 C 12 21.5523 12.4477 22 13 22 C 13.5523 22 14 21.5523 14 21 L 14 3 C 14 2.44772 13.5523 2 13 2 C 12.4477 2 12 2.44772 12 3 L 12 11 L 3 11 L 3 3 C 3 2.44772 2.55228 2 2 2 z M 19.5 11 C 18.1071 11 17.210719 11.718391 16.699219 12.400391 C 16.449619 12.733191 16.286647 13.060134 16.185547 13.302734 C 16.134447 13.425334 16.099219 13.529522 16.074219 13.607422 C 16.059219 13.653922 16.04365 13.700747 16.03125 13.748047 L 16.03125 13.753906 L 16.03125 13.755859 C 16.03125 13.755859 16.029297 13.757812 16.029297 13.757812 C 15.895297 14.293613 16.222012 14.836803 16.757812 14.970703 C 17.290713 15.104003 17.83125 14.7808 17.96875 14.25 C 17.96995 14.2459 17.971563 14.236303 17.976562 14.220703 C 17.986663 14.189203 18.006203 14.137166 18.033203 14.072266 C 18.088403 13.939866 18.175381 13.766809 18.300781 13.599609 C 18.539281 13.281609 18.8928 13 19.5 13 C 20.3819 13 20.859656 13.397475 21.097656 13.859375 C 21.362156 14.372575 21.364069 15.035434 21.105469 15.552734 C 21.013169 15.737234 20.805756 15.939206 20.347656 16.191406 C 20.125756 16.313406 19.87885 16.4305 19.59375 16.5625 L 19.498047 16.605469 C 19.246547 16.721569 18.968966 16.848881 18.697266 16.988281 C 18.087566 17.300981 17.4026 17.720994 16.875 18.371094 C 16.3254 19.048194 16 19.9089 16 21 C 16 21.5523 16.4477 22 17 22 L 23 22 C 23.5523 22 24 21.5523 24 21 C 24 20.4477 23.5523 20 23 20 L 18.195312 20 C 18.261312 19.8592 18.340934 19.737759 18.427734 19.630859 C 18.693534 19.303459 19.086228 19.038831 19.611328 18.769531 C 19.843828 18.650231 20.081991 18.540075 20.337891 18.421875 L 20.433594 18.376953 C 20.716394 18.246053 21.0224 18.102959 21.3125 17.943359 C 21.8783 17.631959 22.525831 17.184666 22.894531 16.447266 C 23.435131 15.366066 23.437253 14.030559 22.876953 12.943359 C 22.290153 11.804859 21.1181 11 19.5 11 z "
        />
    </svg>
)

const MoreVertical = ({ style, className }) => (
    <svg viewBox="0 0 24 24" className={className}>
        <path
            style={style}
            className="ql-stroke ql-fill"
            d="M 12 3 C 10.907275 3 10 3.9072751 10 5 C 10 6.0927249 10.907275 7 12 7 C 13.092725 7 14 6.0927249 14 5 C 14 3.9072751 13.092725 3 12 3 z M 12 10 C 10.907275 10 10 10.907275 10 12 C 10 13.092725 10.907275 14 12 14 C 13.092725 14 14 13.092725 14 12 C 14 10.907275 13.092725 10 12 10 z M 12 17 C 10.907275 17 10 17.907275 10 19 C 10 20.092725 10.907275 21 12 21 C 13.092725 21 14 20.092725 14 19 C 14 17.907275 13.092725 17 12 17 z "
        />
    </svg>
)
//endregion

const HEADING_FORMATS = [
    { value: '3', text: 'Normal text', shortcut: '1', TextStyle: TextStyleNormal },
    { value: '2', text: 'Subheading', shortcut: '2', TextStyle: TextStyleH2 },
    { value: '1', text: 'Heading', shortcut: '3', TextStyle: TextStyleH1 },
]

export const openHeadingPopup = () => {
    if (store.getState().blockShortcuts) {
        return
    }
    renderHeadingPopup(HEADING_FORMATS)
    closeColorPopup()
    const select = document.querySelector(`.ql-header.ql-picker`)
    const options = document.querySelector(`.ql-header.ql-picker .ql-picker-options`)

    select.classList += ' ql-expanded'
    options.setAttribute('aria-hidden', false)
}

export const closeHeadingPopup = () => {
    const selects = document.querySelectorAll(`.ql-header.ql-picker.ql-expanded`)
    const options = document.querySelectorAll(`.ql-header.ql-picker .ql-picker-options`)

    selects.forEach(select => {
        const classValue = select.classList.value
        select.classList = classValue.replace('ql-expanded', '')
    })
    options.forEach(option => {
        option?.setAttribute('aria-hidden', true)
    })
}

const renderHeadingPopup = headingList => {
    return headingList.map(({ value, text, shortcut, TextStyle }, i) => {
        return (
            <option
                key={i}
                value={value}
                data-html={`<div>
                                <i class="ql-header-item-icon">${domServer.renderToString(
                                    <TextStyle style={{ fill: '#ffffff' }} />
                                )}</i>
                                <i class="ql-header-item-shortcut">${domServer.renderToString(
                                    <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />
                                )}</i>
                            </div>`}
            >
                {text}
            </option>
        )
    })
}

export const openColorPopup = (type = 'ql-color') => {
    if (store.getState().blockShortcuts) {
        return
    }
    renderColorPopup(TEXT_COLORS)
    closeColorPopup()
    closeHeadingPopup()
    const select = document.querySelector(`.${type}.ql-picker.ql-color-picker`)
    const options = document.querySelector(`.${type}.ql-picker.ql-color-picker .ql-picker-options`)

    select.classList += ' ql-expanded'
    options.setAttribute('aria-hidden', false)
}

export const closeColorPopup = () => {
    const selects = document.querySelectorAll(`.ql-picker.ql-color-picker.ql-expanded`)
    const options = document.querySelectorAll(`.ql-picker.ql-color-picker .ql-picker-options`)

    selects.forEach(select => {
        const classValue = select.classList.value
        select.classList = classValue.replace('ql-expanded', '')
    })
    options.forEach(option => {
        option?.setAttribute('aria-hidden', true)
    })
}

export const renderColorPopup = colorList => {
    return colorList.map(({ color, name, shortcut }, i) => {
        return (
            <option
                key={i}
                value={color}
                data-html={`<div class="ql-color-item-sub-container">
                                        ${
                                            name === 'None'
                                                ? domServer.renderToString(
                                                      <Icon name={'droplet-off'} size={20} color={'#ffffff'} />
                                                  )
                                                : `<div class="ql-color-item-color" style="background-color: ${color};" ></div>`
                                        }
                                        <span class="ql-color-item-text">${translate(name)}</span>
                                        <i class="ql-color-item-shortcut">${domServer.renderToString(
                                            <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />
                                        )}</i>
                                    </div>`}
            />
        )
    })
}

const responsivePosition = (open, elementId) => {
    if (open) {
        const popup = document.getElementById(elementId)
        let popoverRect = popup.getBoundingClientRect()

        let yOffset = popoverRect.top + popoverRect.height
        let xOffset = popoverRect.left + popoverRect.width
        let finalTop = 28
        let finalLeft = 28

        if (yOffset > window.innerHeight) {
            finalTop -= yOffset - window.innerHeight
        }
        if (xOffset > window.innerWidth) {
            finalLeft -= xOffset - window.innerWidth
        }

        popup.style.top = finalTop.toFixed() + 'px'
        popup.style.left = finalLeft.toFixed() + 'px'
    }
}

const TextFormatPopup = () => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [open, _setOpen] = useState(false)
    const openRef = useRef(open)
    const buttonRef = useRef()

    const setOpen = value => {
        openRef.current = value
        _setOpen(value)
    }

    const onClickOutside = event => {
        const popup = document.getElementById('text-formatting-popup-mobile')
        const button = dom.findDOMNode(buttonRef.current)

        if (!popup.contains(event.target) && button !== event.target && !button.contains(event.target)) {
            popup.style.top = '28px'
            popup.style.left = '28px'
            setOpen(false)
        }
    }

    useEffect(() => {
        responsivePosition(open, 'text-formatting-popup-mobile')
    }, [open])

    useEffect(() => {
        document.addEventListener('click', onClickOutside)

        return () => document.removeEventListener('click', onClickOutside)
    }, [])

    return (
        <div style={{ display: 'inline-block', position: 'relative' }} className={mobile ? '' : 'ql-hide'}>
            <TouchableOpacity
                ref={buttonRef}
                accessibilityLabel={'ql-formats-mobile-btn'}
                onPress={() => setOpen(!openRef.current)}
                style={{ width: 28, height: 28, padding: 5 }}
            >
                <TextFormat />
            </TouchableOpacity>

            <div
                id={'text-formatting-popup-mobile'}
                className={`ql-custom-popup ${openRef.current ? '' : 'ql-hide'}`}
                style={{ width: 180, paddingLeft: 14 }}
            >
                <div className={'ql-custom-popup-item'}>
                    <select
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Text color')}</span>`}
                        className={'ql-color'}
                    >
                        {renderColorPopup(TEXT_COLORS)}
                    </select>
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Underline')}</span>`}
                        className={'ql-underline'}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Italic')}</span>`}
                        className={'ql-italic'}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Cross out text')}</span>`}
                        className={'ql-strike'}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate(
                            'Clear formatting'
                        )}</span>`}
                        className={'ql-clean'}
                    />
                </div>
            </div>
        </div>
    )
}

const addAttachmentTag = (text, uri) => {
    const editor = exportRef.getEditor()
    const inputCursorIndex = editor.getSelection(true).index
    const id = v4()
    insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri, id, LOADING_MODE)
    updateNewAttachmentsDataInNotes(editor, id, text, uri, 'user')
}

const TextMorePopup = ({ projectId, disabled }) => {
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const tablet = useSelector(state => state.isMiddleScreenNoteDV)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const [open, _setOpen] = useState(false)
    const openRef = useRef(open)
    const buttonRef = useRef()
    const isMobile = sidebarExpanded ? tablet : mobile || mobileCollapsed

    const setOpen = value => {
        openRef.current = value
        _setOpen(value)
    }

    const onClickOutside = event => {
        const popup = document.getElementById('text-more-popup-mobile')
        const button = dom.findDOMNode(buttonRef.current)

        if (!popup.contains(event.target) && button !== event.target && !button.contains(event.target)) {
            popup.style.top = '28px'
            popup.style.left = '28px'
            setOpen(false)
        }
    }

    useEffect(() => {
        responsivePosition(open, 'text-more-popup-mobile')
    }, [open])

    useEffect(() => {
        document.addEventListener('click', onClickOutside)
        return () => document.removeEventListener('click', onClickOutside)
    }, [])

    const pointerEvents = disabled ? 'none' : 'auto'
    return (
        <div style={{ display: 'inline-block', position: 'relative' }} className={isMobile ? '' : 'ql-hide'}>
            <TouchableOpacity
                ref={buttonRef}
                accessibilityLabel={'ql-formats-mobile-btn'}
                onPress={() => setOpen(!openRef.current)}
                style={{ width: 28, height: 28, padding: 5, marginLeft: -10 }}
            >
                <MoreVertical />
            </TouchableOpacity>

            {isMobile && (
                <NotesAttachmentsSelectorModal projectId={projectId} addAttachmentTag={addAttachmentTag} space={0} />
            )}

            <div
                id={'text-more-popup-mobile'}
                className={`ql-custom-popup ${openRef.current ? '' : 'ql-hide'}`}
                style={{ width: 180, paddingLeft: 14 }}
            >
                <div className={'ql-custom-popup-item'}>
                    <TouchableOpacity
                        onPress={() => {
                            setOpen(false)
                            modules.toolbar.handlers.link()
                        }}
                        disabled={disabled}
                    >
                        <Icon name={'link'} size={20} color={'#ffffff'} />
                        <span className="ql-custom-popup-text ql-embed" style={{ top: 0 }}>
                            {translate('Insert link')}
                        </span>
                    </TouchableOpacity>
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Insert file')}</span>`}
                        className="ql-image"
                        style={{ pointerEvents }}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Numbered list')}</span>`}
                        className="ql-list"
                        value="ordered"
                        style={{ pointerEvents }}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Bulleted list')}</span>`}
                        className="ql-list"
                        value="bullet"
                        style={{ pointerEvents }}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Decrease indent')}</span>`}
                        className="ql-indent"
                        value="-1"
                        style={{ pointerEvents }}
                    />
                </div>
                <div className={'ql-custom-popup-item'}>
                    <button
                        data-html={`<span class="ql-custom-popup-text ql-embed">${translate('Increase indent')}</span>`}
                        className="ql-indent"
                        value="+1"
                        style={{ pointerEvents }}
                    />
                </div>
            </div>
        </div>
    )
}

export const DecreaseIndent = `
<svg viewBox="0 0 24 24">
        <path
            class="ql-fill ql-stroke"
            d="M7 5c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h12.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-12.999zM8.484 8.434c-0.088 0.003-0.179 0.029-0.262 0.084l-4.598 3.066c-0.297 0.198-0.297 0.634 0 0.832l4.598 3.066c0.332 0.222 0.777-0.017 0.777-0.416v-6.133c0-0.3-0.25-0.508-0.516-0.5zM12 11c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h7.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-7.999zM7 17c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h12.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-12.999z"
        ></path>
</svg>
`

export const IncreaseIndent = `
<svg viewBox="0 0 24 24">
<path class="ql-fill ql-stroke" d="M7 5c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h12.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-12.999zM3.516 8.434c-0.265-0.008-0.516 0.2-0.516 0.5v6.133c0 0.399 0.445 0.638 0.777 0.416l4.598-3.066c0.297-0.198 0.297-0.634 0-0.832l-4.598-3.066c-0.083-0.055-0.173-0.081-0.262-0.084zM12 11c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h7.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-7.999zM7 17c-0.004-0-0.009-0-0.014-0-0.552 0-1 0.448-1 1s0.448 1 1 1c0.005 0 0.010-0 0.015-0h12.999c0.004 0 0.009 0 0.014 0 0.552 0 1-0.448 1-1s-0.448-1-1-1c-0.005 0-0.010 0-0.015 0h-12.999z"></path>
</svg>
`

function undoChange() {
    this.quill.history.undo()
}
function redoChange() {
    this.quill.history.redo()
}

const Size = Quill.import('formats/size')
Size.whitelist = ['extra-small', 'small', 'medium', 'large']
Quill.register(Size, true)

const Font = Quill.import('formats/font')
Font.whitelist = ['arial', 'comic-sans', 'courier-new', 'georgia', 'helvetica', 'lucida']
Quill.register(Font, true)
Quill.register('modules/cursors', QuillCursors)
// Quill.register('modules/imageDrop', ImageDrop)
Quill.register('modules/dragAndDrop', DragAndDropModule, true)
Quill.register({
    'modules/autoformat': Autoformat,
    'formats/hashtag': Hashtag,
    'formats/mention': Mention,
    'formats/url': Url,
    'formats/email': Email,
    'formats/commentTagFormat': CommentTagFormat,
    'formats/attachment': Attachment,
    'formats/customImageFormat': CustomImageFormat,
    'formats/videoFormat': VideoFormat,
    'formats/taskTagFormat': TaskTagFormat,
    'formats/autoformat-helper': AutoformatHelperAttribute,
    'formats/karma': Karma,
    'formats/milestoneTag': MilestoneTag,
})

const LinkFormat = Quill.import('formats/link')
const builtInFunc = LinkFormat.sanitize
LinkFormat.sanitize = function customSanitizeLinkInput(linkValueInput) {
    let val = linkValueInput

    // do nothing, since this implies user's already using a custom protocol
    if (/^\w+:/.test(val));
    else if (!/^https?:/.test(val)) val = 'https://' + val

    return builtInFunc.call(this, val) // retain the built-in logic
}

const image_content_type_pattern = DragAndDropModule.image_content_type_pattern
const getFileDataUrl = DragAndDropModule.utils.getFileDataUrl

const convertContentToText = (projectId, deltaContent) => {
    let textExtended = ''

    for (let i = 0; i < deltaContent.ops.length; i++) {
        const op = deltaContent.ops[i]
        const { insert } = op
        const { mention, hashtag, email, url, attachment, customImageFormat, videoFormat, taskTagFormat } = insert

        let beforeSpace = ''
        if (i > 0) {
            const previousInsert = deltaContent.ops[i - 1].insert
            if (
                typeof previousInsert !== 'string' ||
                previousInsert.length === 0 ||
                previousInsert[previousInsert.length - 1] !== ' '
            ) {
                beforeSpace = ' '
            }
        }

        let afterSpace = ''
        if (i + 1 < deltaContent.ops.length) {
            const nextInsert = deltaContent.ops[i + 1].insert
            if (typeof nextInsert !== 'string' || nextInsert.length === 0 || nextInsert[0] !== ' ') {
                afterSpace = ' '
            }
        }

        if (mention) {
            const mentionText = `@${mention.text.replaceAll(' ', MENTION_SPACE_CODE)}`
            const mextionTextExtended =
                mention.userId === NOT_USER_MENTIONED ? mentionText : `${mentionText}#${mention.userId}`
            textExtended += beforeSpace + mextionTextExtended + afterSpace
        } else if (attachment) {
            const attachmentText = `${ATTACHMENT_TRIGGER}${attachment.uri}${ATTACHMENT_TRIGGER}${attachment.text}${ATTACHMENT_TRIGGER}${attachment.isNew}`
            textExtended += beforeSpace + attachmentText + afterSpace
        } else if (customImageFormat) {
            const imageText = `${IMAGE_TRIGGER}${customImageFormat.uri}${IMAGE_TRIGGER}${customImageFormat.resizedUri}${IMAGE_TRIGGER}${customImageFormat.text}${IMAGE_TRIGGER}${customImageFormat.isNew}`
            textExtended += beforeSpace + imageText + afterSpace
        } else if (videoFormat) {
            const videoText = `${VIDEO_TRIGGER}${videoFormat.uri}${VIDEO_TRIGGER}${videoFormat.text}${VIDEO_TRIGGER}${videoFormat.isNew}`
            textExtended += beforeSpace + videoText + afterSpace
        } else if (hashtag) {
            const hashtagText = `#${hashtag.text}`
            textExtended += beforeSpace + hashtagText + afterSpace
        } else if (email) {
            textExtended += beforeSpace + email.text + afterSpace
        } else if (url) {
            textExtended += beforeSpace + url.url + afterSpace
        } else if (taskTagFormat) {
            const { taskId } = taskTagFormat
            const url = `${window.location.origin}${getDvMainTabLink(projectId, taskId, 'tasks')}`
            textExtended += beforeSpace + url + afterSpace
        } else {
            textExtended += insert
        }
    }

    textExtended = textExtended.substring(0, textExtended.length - 1)
    return textExtended
}

const generateLinkToChat = (objectType, objectId, projectId) => {
    return getDvChatTabLink(projectId, objectId, objectType === 'topics' ? 'chats' : objectType)
}

export const modules = {
    toolbar: {
        container: '#toolbar',

        handlers: {
            undo: undoChange,
            redo: redoChange,
            comment: () => {
                const { blockShortcuts } = store.getState()

                if (blockShortcuts) {
                    return
                }
                const editor = exportRef.getEditor()
                const selection = editor.getSelection(true)
                const contents = editor.getContents(selection.index, selection.length)

                const placeholder = exportRef.props.placeholder
                const { editorId } = getPlaceholderData(placeholder)
                const projectId = quillTextInputProjectIds[editorId]

                const textExtended = convertContentToText(projectId, contents)
                if (textExtended.trim().length > 0) {
                    store.dispatch(setQuotedNoteText(`[quote]${textExtended}[quote]\n`))
                }

                const objectType = loadedNote.parentObject ? loadedNote.parentObject.type : 'notes'
                const objectId = loadedNote.parentObject ? loadedNote.parentObject.id : editorId

                const chatLink = generateLinkToChat(objectType, objectId, projectId)
                URLTrigger.processUrl(NavigationService, chatLink)
            },
            list: type => {
                if (store.getState().blockShortcuts) {
                    return
                }
                const editor = exportRef.getEditor()
                const selection = editor.getSelection(true)
                const format = editor.getFormat(selection)
                editor.format('list', format['list'] ? false : type, 'user')
            },
            strike: () => {
                if (store.getState().blockShortcuts) {
                    return
                }
                const editor = exportRef.getEditor()
                const selection = editor.getSelection(true)
                const format = editor.getFormat(selection)
                editor.format('strike', !format['strike'], 'user')
            },
            clean: () => {
                const editor = exportRef.getEditor()
                const selection = editor.getSelection()
                editor.removeFormat(selection, 'user')
            },
            textFont: (header, scrollRef, scrollYPos) => {
                const scrollY = scrollYPos.current
                const editor = exportRef.getEditor()
                editor.format('header', header, 'user')
                scrollRef.current.scrollTo({ x: 0, y: scrollY, animated: false })
            },
            textColor: (color, scrollRef, scrollYPos, type = 'color') => {
                const scrollY = scrollYPos.current
                const editor = exportRef.getEditor()
                editor.format(type === 'color' ? 'color' : 'background', color, 'user')
                scrollRef.current.scrollTo({ x: 0, y: scrollY, animated: false })
            },
            image: () => {
                if (store.getState().blockShortcuts) {
                    return
                }
                document.body.click()
                const placeholder = exportRef.props.placeholder
                const { editorId } = getPlaceholderData(placeholder)
                const projectId = quillTextInputProjectIds[editorId]
                if (!checkIsLimitedByTraffic(projectId)) {
                    store.dispatch(storeOpenModal(ATTACHMENTS_SELECTOR_MODAL_ID))
                }
            },
            link: () => {
                const editor = exportRef.getEditor()
                const selection = editor.getSelection(true)
                const newDelta = new Delta()
                const placeholder = exportRef.props.placeholder
                const { editorId } = getPlaceholderData(placeholder)

                const url = getUrlObject('', '', null, editorId, store.getState().loggedUser.uid)
                url.open = true
                newDelta.retain(selection.index + selection.length)
                newDelta.insert(' ')
                newDelta.insert({ url })
                editor.updateContents(newDelta)
            },
        },
    },
    dragAndDrop: {
        // draggables is an array containing the types of files that are allowed
        // to be dragged onto the editor, and the type of html element & name of
        // html attribute that will be added to the editor from this file
        draggables: [
            {
                // string regex pattern used to match a dropped file's `type`
                content_type_pattern: image_content_type_pattern,

                // the type of html element that will be added when a file matching
                // this draggable is dropped on the editor
                tag: 'img',

                // the attribute of the created html element that will be set based on
                // the file's data & result of onDrop (see below)
                attr: 'src',
            },
            {
                content_type_pattern: '^video/',
                tag: 'video',
                attr: 'src',
            },
            {
                content_type_pattern: '^text/',
                tag: 'div',
                attr: 'src',
            },
            {
                content_type_pattern: '^audio/',
                tag: 'div',
                attr: 'src',
            },
            {
                content_type_pattern: '^application/',
                tag: 'div',
                attr: 'src',
            },
        ],

        // onDrop will be called any time a file with a type matching a
        // content_type_pattern defined in draggables is dropped on the editor
        // params:
        //    file - the File object that was dropped
        onDrop(file) {
            return getFileDataUrl(file)
                .then(base64_content => {
                    // do something with the base64 content
                    // e.g. save file to server, resize image, add a watermark, etc.

                    const id = v4()
                    const uri = URL.createObjectURL(file)
                    const editor = exportRef.getEditor()
                    const index = (editor.getSelection() || {}).index || editor.getLength()

                    insertAttachmentInsideEditor(index, editor, file.name.replaceAll(/\s/g, '_'), uri, id, LOADING_MODE)
                    updateNewAttachmentsDataInNotes(editor, id, file.name.replaceAll(/\s/g, '_'), uri, 'user')
                })
                .then(response_from_do_something => {
                    // whatever you return (or promise) from `onDrop` will be used as the
                    // value of the `attr` attribute for the new html element,
                    // with a couple of exceptions:
                    //   returning `false` from `onDrop` =>
                    //     this file will be ignored; no new element will be added to the
                    //     editor
                    //   returning `null` from `onDrop` =>
                    //     the file's data url (i.e. base64 representation) will be used
                    //     it's the same as if you'd done:
                    //       `onDrop: DragAndDropModule.utils.getFileDataUrl`
                    //     This is the default behavior (i.e., it's what will happen if
                    //     you don't define `onDrop`)
                    return false
                })
                .catch(err => {
                    console.log(err)
                    // return false to tell Quill to ignore this dropped file
                    return false
                })
        },
    },
    // imageDrop: true,
    history: {
        maxStack: 100,
        userOnly: true,
        beforeUndoRedo,
    },
    // clipboard: {
    //     allowed: {
    //         tags: ['p', 'br', 'img', 'picture', 'ul', 'ol', 'li'],
    //         attributes: ['src', 'alt'],
    //     },
    // },
    cursors: true,
    autoformat: true,
}

export const formats = [
    'header',
    'font',
    'size',
    'bold',
    'italic',
    'underline',
    //'align',
    'strike',
    'script',
    'blockquote',
    'background',
    'list',
    'bullet',
    'indent',
    'link',
    'image',
    'color',
    'code-block',
    'hashtag',
    'mention',
    'url',
    'email',
    'autoformat-helper',
    'attachment',
    'customImageFormat',
    'videoFormat',
    'taskTagFormat',
]

export const EditorToolbar = ({
    renderTimestamp,
    renderTask,
    editors,
    peersSynced,
    clicked,
    setClicked,
    project,
    accessGranted,
    isFullscreen,
    setFullscreen,
    projectId,
    readOnly,
    connectionState,
    disabled,
    scrollYPos,
    scrollRef,
    getEditor,
}) => {
    const usersInProject = useSelector(state => state.projectUsers[project.id])
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreenNoteDV)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const shortcutCtrl = useSelector(state => state.showNoteCtrlShortcuts)
    const shortcutAlt = useSelector(state => state.showNoteAltShortcuts)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile || mobileCollapsed

    useEffect(() => {
        shortcutNotePreviewMount()
        return () => shortcutNotePreviewUnmount()
    }, [])

    const keepScroll = () => {
        const scrollY = scrollYPos.current
        scrollRef.current.scrollTo({ x: 0, y: scrollY, animated: false })
    }

    const barPointerEvents = readOnly || disabled ? 'none' : 'auto'
    const commentPointerEvents = connectionState === 'offline' || disabled ? 'none' : 'auto'

    const [isRecording, setIsRecording] = useState(false)
    const mediaRecorderRef = useRef(null)
    const streamsRef = useRef([]) // Store all streams to stop them
    const audioContextRef = useRef(null)
    const intervalRef = useRef(null)

    const stopRecording = () => {
        if (intervalRef.current) {
            clearTimeout(intervalRef.current)
            intervalRef.current = null
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }

        streamsRef.current.forEach(stream => {
            try {
                stream.getTracks().forEach(track => track.stop())
            } catch (e) {
                console.error('Error stopping tracks', e)
            }
        })
        streamsRef.current = []

        if (audioContextRef.current) {
            try {
                audioContextRef.current.close()
            } catch (e) {
                console.error('Error closing AudioContext', e)
            }
            audioContextRef.current = null
        }

        setIsRecording(false)
    }

    const toggleTranscription = async () => {
        if (isRecording) {
            stopRecording()
            return
        }

        try {
            // Insert Date + Transcription Header
            const headerEditor = getEditor ? getEditor() : exportRef ? exportRef.getEditor() : null
            if (headerEditor) {
                try {
                    const range = headerEditor.getSelection(true) || { index: headerEditor.getLength() }
                    const dateStr = moment().format(`${getDateFormat(false)} `)
                    const headerText = `${dateStr} ${translate('Transcription')}`
                    headerEditor.insertText(range.index, headerText, 'user')
                    headerEditor.insertText(range.index + headerText.length, '\n', { header: 1 }, 'user')
                    setTimeout(() => {
                        headerEditor.setSelection(range.index + headerText.length + 1, 0, 'user')
                    })
                } catch (e) {
                    console.error('Error inserting transcription header', e)
                }
            } else {
                console.warn('No editor instance available for header insertion')
            }

            // Request both System Audio and Microphone
            // We do this sequentially or parallel. Parallel is faster but let's be safe.
            // Note: getDisplayMedia must be triggered by user gesture, which we have.

            const systemStreamPromise = navigator.mediaDevices.getDisplayMedia({
                video: true, // Required
                audio: true,
            })

            const micStreamPromise = navigator.mediaDevices
                .getUserMedia({
                    audio: true,
                })
                .catch(err => {
                    console.warn('Could not get microphone access', err)
                    return null
                })

            const [systemStream, micStream] = await Promise.all([systemStreamPromise, micStreamPromise])

            const audioTracks = systemStream.getAudioTracks()
            if (audioTracks.length === 0) {
                alert(translate('Please ensure you share audio when selecting the screen/tab.'))
                systemStream.getTracks().forEach(track => track.stop())
                if (micStream) micStream.getTracks().forEach(track => track.stop())
                return
            }

            // Mix Audio
            const audioContext = new (window.AudioContext || window.webkitAudioContext)()
            audioContextRef.current = audioContext
            const destination = audioContext.createMediaStreamDestination()

            const systemSource = audioContext.createMediaStreamSource(systemStream)
            systemSource.connect(destination)

            if (micStream) {
                const micSource = audioContext.createMediaStreamSource(micStream)
                micSource.connect(destination)
                streamsRef.current.push(micStream)
            }
            streamsRef.current.push(systemStream)

            // Handle stream stop from browser UI (System Stream only usually)
            if (systemStream.getVideoTracks().length > 0) {
                systemStream.getVideoTracks()[0].onended = () => {
                    stopRecording()
                }
            }
            // Some browsers kill audio track if video track is killed
            if (systemStream.getAudioTracks().length > 0) {
                systemStream.getAudioTracks()[0].onended = () => {
                    // stopRecording()
                    // Don't stop entirely if just one track ends? But here system audio is critical.
                    stopRecording()
                }
            }

            setIsRecording(true)

            const startNextChunk = () => {
                if (!isRecording && !streamsRef.current.length) return // Stopped

                const mixedStream = destination.stream
                const mimeType = 'audio/webm' // Chrome defaults to this
                // Try to use MediaRecorder
                let recorder
                try {
                    recorder = new MediaRecorder(mixedStream, { mimeType })
                } catch (e) {
                    console.error('MediaRecorder creation failed', e)
                    // Fallback or error handling
                    alert('Browser not supported for audio recording')
                    stopRecording()
                    return
                }

                mediaRecorderRef.current = recorder

                recorder.ondataavailable = async event => {
                    if (event.data.size > 0) {
                        const reader = new FileReader()
                        reader.readAsDataURL(event.data)
                        reader.onloadend = async () => {
                            const base64data = reader.result
                            try {
                                const result = await firebase
                                    .app()
                                    .functions('europe-west1')
                                    .httpsCallable('transcribeMeetingAudio')({
                                    audioChunk: base64data,
                                })
                                const text = result.data.text
                                if (text && text.trim().length > 0) {
                                    const editor = exportRef.getEditor()
                                    const length = editor.getLength()
                                    editor.insertText(length, `\n${text.trim()} `, 'user')
                                    editor.setSelection(length + text.length + 2)
                                }
                            } catch (err) {
                                console.error('Transcription error:', err)
                                if (err.code === 'resource-exhausted' || err.message?.includes('Insufficient Gold')) {
                                    store.dispatch(
                                        setShowLimitedFeatureModal({
                                            title: translate('Not enough Gold'),
                                            description: translate(
                                                'You do not have enough Gold to transcribe this audio. Please upgrade or buy more Gold.'
                                            ),
                                        })
                                    )
                                    stopRecording()
                                }
                            }
                        }
                    }
                }

                recorder.start()
                // Stop and restart execution after 10 seconds to create effective chunks with headers
                intervalRef.current = setTimeout(() => {
                    if (recorder.state !== 'inactive') {
                        recorder.stop()
                        // Start next chunk immediately (recurse)
                        // Need check if we are still recording
                        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                            startNextChunk()
                        }
                    }
                }, 10000)
            }

            startNextChunk()
        } catch (err) {
            console.error('Error starting transcription:', err)
            if (err.name !== 'NotAllowedError') {
                alert(translate('Could not start recording: ') + err.message)
            }
        }
    }

    return (
        <div
            id="toolbar-container"
            className={`ql-toolbar-container ${!mobile && mobileCollapsed ? 'ql-toolbar-container-collapsed' : ''}`}
            style={{ height: (clicked ? 184 : 76) + (isRecording ? 32 : 0) }}
        >
            {isRecording && (
                <div
                    style={{
                        backgroundColor: colors.Red200, // or colors.Blue/Green depending on preference
                        width: '100%',
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 16,
                    }}
                >
                    <Text style={{ color: 'white', fontWeight: '500', fontSize: 13 }}>
                        {translate('Transcription active. Keep tab in the foreground')}
                    </Text>
                    <TouchableOpacity
                        onPress={stopRecording}
                        style={{
                            backgroundColor: 'rgba(255,255,255,0.2)',
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 4,
                        }}
                    >
                        <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>{translate('Stop')}</Text>
                    </TouchableOpacity>
                </div>
            )}
            <div style={{ marginTop: 8 }} id="toolbar">
                <div className="ql-formats2" style={{ paddingLeft: 8 }}>
                    <span className={'ql-toolbar-item'}>
                        {(shortcutAlt || shortcutCtrl) && (
                            <Shortcut text={'f11'} parentStyle={localStyles.shortcuts.screenMode} />
                        )}
                        <button
                            onClick={() => setFullscreen(!isFullscreen)}
                            style={{ paddingLeft: 6, paddingRight: 6 }}
                        >
                            <TouchableOpacity style={{ flexDirection: 'row', maxHeight: 20 }}>
                                <View style={{ width: 20 }}>
                                    <Icon
                                        name={isFullscreen ? 'minimize' : 'maximize'}
                                        size={20}
                                        color={colors.Text03}
                                    />
                                </View>
                            </TouchableOpacity>
                        </button>
                    </span>
                </div>

                <div style={localStyles.separator} />

                {accessGranted && (
                    <span className="ql-formats" style={{ pointerEvents: barPointerEvents }} onClick={keepScroll}>
                        {shortcutAlt && <Shortcut text={'1'} parentStyle={localStyles.shortcuts.qlFormats} />}
                        <select className="ql-header" defaultValue="3">
                            {renderHeadingPopup(HEADING_FORMATS)}
                        </select>
                    </span>
                )}
                {accessGranted && (
                    <div className="ql-formats2" style={{ pointerEvents: barPointerEvents }}>
                        <span className={'ql-toolbar-item'}>
                            {shortcutCtrl && <Shortcut text={'B'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className="ql-bold" />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutCtrl && <Shortcut text={'U'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className={`ql-underline ${mobile ? 'ql-hide' : ''}`} />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutCtrl && <Shortcut text={'I'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className={`ql-italic ${mobile ? 'ql-hide' : ''}`} />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutAlt && <Shortcut text={'Z'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className={`ql-strike ${mobile ? 'ql-hide' : ''}`} />
                        </span>

                        <span className={'ql-toolbar-item'} onClick={keepScroll}>
                            {shortcutAlt && (
                                <Shortcut text={'3'} parentStyle={localStyles.shortcuts.qlBackgroundColor} />
                            )}
                            <select className={'ql-background'}>{renderColorPopup(BACKGROUND_COLORS)}</select>
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutCtrl && (
                                <Shortcut
                                    text={<Icon name={'spacebar'} color={'#ffffff'} size={12} />}
                                    parentStyle={localStyles.shortcuts.regular}
                                    custom={true}
                                />
                            )}
                            <button className={`ql-clean ${mobile ? 'ql-hide' : ''}`} />
                        </span>
                        <TextFormatPopup />
                    </div>
                )}

                {accessGranted && <div style={localStyles.separator} />}

                <span className="ql-formats2">
                    {accessGranted && (
                        <span className={'ql-toolbar-item'} style={{ pointerEvents: barPointerEvents }}>
                            {shortcutAlt && <Shortcut text={'4'} parentStyle={localStyles.shortcuts.regular} />}
                            <button style={{ marginLeft: tablet ? 0 : 8, paddingLeft: 6, paddingRight: 6 }}>
                                <TouchableOpacity
                                    style={{ flexDirection: 'row', maxHeight: 20 }}
                                    onPress={renderTimestamp}
                                >
                                    <View style={{ width: 20 }}>
                                        <Timestamp />
                                    </View>
                                    {!tablet && (
                                        <Text style={[styles.caption1, localStyles.barIconText]}>
                                            {translate('Date')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </button>
                        </span>
                    )}
                    {accessGranted && (
                        <span className={'ql-toolbar-item'} style={{ pointerEvents: barPointerEvents }}>
                            {shortcutAlt && <Shortcut text={'T'} parentStyle={localStyles.shortcuts.regular} />}
                            <button onClick={renderTask} style={{ paddingLeft: 6, paddingRight: 6 }}>
                                <TouchableOpacity style={{ flexDirection: 'row', maxHeight: 20 }}>
                                    <View style={{ width: 20 }}>
                                        <Task />
                                    </View>
                                    {!tablet && (
                                        <Text style={[styles.caption1, localStyles.barIconText]}>
                                            {translate('Task')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </button>
                        </span>
                    )}
                    <span className={'ql-toolbar-item'} style={{ pointerEvents: commentPointerEvents }}>
                        {shortcutAlt && <Shortcut text={'C'} parentStyle={localStyles.shortcuts.regular} />}
                        <button className="ql-comment">
                            {!tablet && (
                                <Text style={[styles.caption1, localStyles.barIconText]}>{translate('Comment')}</Text>
                            )}
                            <Comment />
                        </button>
                    </span>

                    <span className={'ql-toolbar-item'} style={{ pointerEvents: barPointerEvents }}>
                        <button onClick={toggleTranscription} style={{ paddingLeft: 6, paddingRight: 6 }}>
                            <TouchableOpacity style={{ flexDirection: 'row', maxHeight: 20 }}>
                                <View style={{ width: 20, alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon
                                        name={isRecording ? 'mic-off' : 'mic'}
                                        size={18}
                                        color={isRecording ? colors.Red200 : colors.Text03}
                                    />
                                </View>
                                {!tablet && (
                                    <Text
                                        style={[
                                            styles.caption1,
                                            localStyles.barIconText,
                                            isRecording ? { color: colors.Red200 } : {},
                                        ]}
                                    >
                                        {isRecording ? translate('Stop') : translate('Transcribe')}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </button>
                    </span>
                </span>

                {accessGranted && <div style={localStyles.separator} />}
                {accessGranted && (
                    <span
                        className={`ql-formats2 ${isMobile ? 'ql-hide' : ''}`}
                        style={{ pointerEvents: barPointerEvents }}
                    >
                        <span className={'ql-toolbar-item'}>
                            {shortcutCtrl && <Shortcut text={'K'} parentStyle={localStyles.shortcuts.regular} />}
                            <TouchableOpacity onPress={modules.toolbar.handlers.link}>
                                <Icon name={'link'} size={20} color={colors.Text03} style={{ paddingHorizontal: 6 }} />
                            </TouchableOpacity>
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutAlt && <Shortcut text={'U'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className="ql-image" />
                            {!isMobile && (
                                <NotesAttachmentsSelectorModal
                                    projectId={projectId}
                                    addAttachmentTag={addAttachmentTag}
                                />
                            )}
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutAlt && <Shortcut text={'5'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className="ql-list" value="ordered" />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {shortcutAlt && <Shortcut text={'6'} parentStyle={localStyles.shortcuts.regular} />}
                            <button className="ql-list" value="bullet" />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            {(shortcutAlt || shortcutCtrl) && (
                                <Shortcut
                                    text={
                                        <View style={{ flexDirection: 'row' }}>
                                            <Icon name={'shift-key'} color={'#ffffff'} size={12} />
                                            <Text style={{ ...styles.caption1, lineHeight: 12, color: '#ffffff' }}>
                                                +Tab, Tab
                                            </Text>
                                        </View>
                                    }
                                    parentStyle={localStyles.shortcuts.qlIndentMinus}
                                    custom={true}
                                />
                            )}
                            <button className="ql-indent" value="-1" />
                        </span>
                        <span className={'ql-toolbar-item'}>
                            <button className="ql-indent" value="+1" />
                        </span>
                    </span>
                )}
                {accessGranted && <TextMorePopup projectId={projectId} disabled={readOnly || disabled} />}
                <div style={localStyles.separator} />
                <span></span>
                <span className="ql-formats-editors">
                    <EditorsGroup
                        editorsInfo={uniqBy(editors, 'id')}
                        users={usersInProject || [loggedUser]}
                        markAssignee={false}
                        peersSynced={peersSynced}
                    />
                </span>
                {/* <span className="ql-formats">
            <button className="ql-undo">
                <CustomUndo />
            </button>
            <button className="ql-redo">
                <CustomRedo />
            </button>
        </span> */}
                {/*<div className="ql-toolbar-scroll-indicator">
                    <Icon name="chevron-left" size={24} color={colors.Text03}></Icon>
                    <Icon name="chevron-right" size={24} color={colors.Text03}></Icon>
                </div>*/}
            </div>
        </div>
    )
}

const localStyles = {
    separator: { backgroundColor: colors.Grey300, width: 2, height: 40, marginLeft: 0, marginRight: 11 },
    barIconText: {
        marginLeft: 4,
        color: colors.Text03,
    },
    shortcuts: {
        regular: { position: 'absolute', top: -11, right: -5 },
        qlFormats: { position: 'absolute', top: -1, right: -18 },
        qlTextColor: { position: 'absolute', top: -7, right: -4 },
        qlBackgroundColor: { position: 'absolute', top: -7, right: -4, zIndex: 1 },
        qlIndentMinus: { position: 'absolute', top: -11, right: -52, zIndex: 1 },
        screenMode: { position: 'absolute', top: -11, right: -2, zIndex: 1 },
    },
}

export default EditorToolbar
