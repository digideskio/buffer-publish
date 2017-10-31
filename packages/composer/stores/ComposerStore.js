import { EventEmitter } from 'events';
import { EditorState, ContentState } from '@bufferapp/draft-js';
import debounce from 'lodash.debounce';
import findLastIndexOf from 'lodash.findlastindex';
import cloneDeep from 'lodash.clonedeep';
import twitterText from 'twitter-text';
import AppDispatcher from '../dispatcher';
import {
  ActionTypes, Services, AttachmentTypes, MediaTypes, ComposerInitiators,
  AppEnvironments, NotificationScopes, ErrorTypes, InlineErrorTypes,
} from '../AppConstants';
import AppStore from './AppStore';
import AppActionCreators from '../action-creators/AppActionCreators';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import { addShortLink as addEditorShortLink, replaceLink as replaceEditorLink }
  from '../utils/draft-js-custom-plugins/short-link';
import NotificationStore from './NotificationStore';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import { prepopulatedMentionStrategy, addPrepopulatedMention as addEditorPrepopulatedMention }
  from '../utils/draft-js-custom-plugins/prepopulated-autocomplete-mention';
import { prepopulatedHashtagStrategy, addPrepopulatedHashtag as addEditorPrepopulatedHashtag }
  from '../utils/draft-js-custom-plugins/prepopulated-autocomplete-hashtag';
import { addImportedMention as addEditorImportedFacebookMention }
  from '../utils/draft-js-custom-plugins/imported-facebook-mention-entities';
import removeFacebookAutocompleteEntities
  from '../utils/draft-js-custom-plugins/autocomplete/utils/removeFacebookAutocompleteEntities';

const CHANGE_EVENT = 'change';

const getNewDraft = (service) => ({
  id: service.name, // Unique identifier; currently that's the service name
  service, // Service data structure in AppConstants.js
  editorState: EditorState.createEmpty(),
  urls: [], // Urls contained in the text
  unshortenedUrls: [], // Urls unshortened by user
  link: null, // Link Attachment; data structure in getNewLink()
  tempImage: null, // Thumbnail of media actively considered for Media Attachment
  images: [], // Media Attachment (type: image), data structure in getNewImage()
  availableImages: [],
  video: null, // Media Attachment (type: video); data structure in getNewVideo()
  videoThumbnailPickerPayload: null, // Video data used when actively picking a thumbnail
  gif: null, // Media Attachment (type: gif); data structure in getNewGif()
  retweet: null, // Data structure in getNewRetweet()
  characterCount: service.charLimit === null ? null : 0, // Only updated for services w/ char limit
  isEnabled: false,
  fileUploadProgress: null, // 0-100, or null if no upload in progress
  enabledAttachmentType:
    (service.canHaveAttachmentType(AttachmentTypes.MEDIA) &&
     !service.canHaveAttachmentType(AttachmentTypes.LINK)) ?
       AttachmentTypes.MEDIA : null,
  sourceLink: null, // Source url and page metadata; data structure in getNewSourceLink()
  isSaved: false,
  savingErrorType: null,
  shortLinkLongLinkMap: new Map(),
  scheduledAt: null,
  isPinnedToSlot: null, // null when scheduledAt is null, true/false otherwise
});

const isDraftEmpty = (draft) => (
  draft.editorState.getCurrentContent().getPlainText().length === 0 &&
  (draft.enabledAttachmentType !== AttachmentTypes.LINK || draft.link === null) &&
  (draft.enabledAttachmentType !== AttachmentTypes.MEDIA || draft.images.length === 0) &&
  (draft.enabledAttachmentType !== AttachmentTypes.MEDIA || draft.video === null) &&
  (draft.enabledAttachmentType !== AttachmentTypes.MEDIA || draft.gif === null) &&
  (draft.enabledAttachmentType !== AttachmentTypes.RETWEET || draft.retweet === null) &&
  draft.sourceLink === null
);

// Link Attachment factory
const getNewLink =
  ({ url, title = null, description = null, thumbnail = null, thumbnailHttps = null,
    availableThumbnails = null, wasEdited = false }) =>
  ({ url, title, description, thumbnail, thumbnailHttps, availableThumbnails, wasEdited });

// SourceLink Attachment factory (source url and its available images)
const getNewSourceLink = (url) => ({
  url,
  availableImages: [],
});

// Available images factory
const getNewAvailableImage = (image, sourceLink) => ({
  url: image.url,
  mediaType: MediaTypes.IMAGE,
  sourceLink,
  width: image.width,
  height: image.height,
});

// Image factory
const getNewImage = (url, width = null, height = null, altText = null) => ({
  url,
  mediaType: MediaTypes.IMAGE,
  width,
  height,
  altText,
});

// Gif factory
const getNewGif = (gifUrl, gifStillUrl, width = null, height = null) => ({
  url: gifUrl,
  stillGifUrl: gifStillUrl,
  mediaType: MediaTypes.GIF,
  width,
  height,
});

// Video factory
const getNewVideo =
  ({ uploadId = null, name, duration, durationMs, size, width, height, url, originalUrl,
    thumbnail, availableThumbnails }) =>
  ({ uploadId, name, duration, durationMs, size, width, height, url, originalUrl,
    thumbnail, availableThumbnails, mediaType: MediaTypes.VIDEO });

// Retweet factory
const getNewRetweet = ({ text, tweetId, userId, userName, userDisplayName, tweetUrl, avatarUrl }) =>
  ({ text, tweetId, userId, userName, userDisplayName, tweetUrl, avatarUrl });

const getInitialState = () => ({
  drafts: Services.map((service) => getNewDraft(service)),
  draftsSharedData: {
    uploadedImages: [],
    uploadedGifs: [],
    processingVideos: new Map(), // uploadId => drafId
    uploadedVideos: [],
  },
  meta: {
    lastInteractedWithComposerId: null,
  },
});

let state = getInitialState();

const ComposerStore = Object.assign({}, EventEmitter.prototype, {
  emitChange: () => ComposerStore.emit(CHANGE_EVENT),
  addChangeListener: (callback) => ComposerStore.on(CHANGE_EVENT, callback),
  removeChangeListener: (callback) => ComposerStore.removeListener(CHANGE_EVENT, callback),

  getEnabledDrafts: () => state.drafts.filter((draft) => draft.isEnabled),
  getDrafts: () => state.drafts,

  getInvalidEnabledDraftsFeedback: () => (
    ComposerStore.getEnabledDrafts().reduce((invalidDraftsFeedback, draft) => {
      const hasText = draft.editorState.getCurrentContent().hasText();

      const hasLinkAttached =
        draft.enabledAttachmentType === AttachmentTypes.LINK && draft.link !== null;
      const hasRetweetAttached =
        draft.enabledAttachmentType === AttachmentTypes.RETWEET && draft.retweet !== null;
      const hasMediaAttached =
        draft.enabledAttachmentType === AttachmentTypes.MEDIA &&
        (draft.images.length > 0 || draft.video !== null || draft.gif !== null);
      const hasAnyAttachment = hasLinkAttached || hasRetweetAttached || hasMediaAttached;

      const hasRequiredAttachmentAttached =
        draft.service.requiredAttachmentType === null ||
        (draft.service.requiredAttachmentType === AttachmentTypes.LINK && hasLinkAttached) ||
        (draft.service.requiredAttachmentType === AttachmentTypes.RETWEET && hasRetweetAttached) ||
        (draft.service.requiredAttachmentType === AttachmentTypes.MEDIA && hasMediaAttached);

      const isSourceUrlUnrequiredOrValid =
        !draft.service.canHaveSourceUrl ||
        draft.sourceLink === null ||
        twitterText.isValidUrl(draft.sourceLink.url, true, false);

      const hasRequiredText =
        !draft.service.requiresText || hasText;

      const isInvalid =
        (!hasText && !hasAnyAttachment) ||
        !hasRequiredAttachmentAttached ||
        !hasRequiredText ||
        !isSourceUrlUnrequiredOrValid;


      if (isInvalid) {
        const messages = [];
        let requiredAttachmentCopy;
        let canHaveImageOrGifAttachment;
        let canHaveVideoAttachment;
        switch (draft.service.requiredAttachmentType) {
          case AttachmentTypes.LINK:
            requiredAttachmentCopy = 'a link preview';
            break;

          case AttachmentTypes.RETWEET:
            requiredAttachmentCopy = 'a retweet';
            break;

          case AttachmentTypes.MEDIA:
            canHaveImageOrGifAttachment =
              draft.service.canHaveSomeMediaAttachmentTypes([MediaTypes.IMAGE, MediaTypes.GIF]);
            canHaveVideoAttachment = draft.service.canHaveMediaAttachmentType(MediaTypes.VIDEO);

            if (canHaveImageOrGifAttachment && canHaveVideoAttachment) {
              requiredAttachmentCopy = 'an image or video';
            } else if (canHaveImageOrGifAttachment) {
              requiredAttachmentCopy = 'an image';
            } else if (canHaveVideoAttachment) {
              requiredAttachmentCopy = 'a video';
            }
            break;
          default:
            break;
        }

        if (!hasRequiredAttachmentAttached && !hasRequiredText) {
          messages.push(`Please include ${requiredAttachmentCopy} and some text`);
        } else if (!hasRequiredAttachmentAttached) {
          messages.push(`Please include ${requiredAttachmentCopy}`);
        } else if (!hasRequiredText) {
          messages.push('Please include some text');
        } else if (!hasText && !hasAnyAttachment) {
          messages.push('Please include at least some text or an attachment');
        }

        if (!isSourceUrlUnrequiredOrValid) {
          messages.push('Please include a valid source url or leave the source url blank');
        }

        invalidDraftsFeedback.push({ draft, messages });
      }

      return invalidDraftsFeedback;
    }, [])
  ),

  getDraft: (id) => state.drafts.find((draft) => draft.id === id),
  getDraftText: (id) => ComposerStore.getDraft(id).editorState.getCurrentContent().getPlainText(),

  getDraftLinkUrl: (id) => {
    const link = ComposerStore.getDraft(id).link;
    return link ? link.url : null;
  },

  doesDraftHaveLinkAttachment: (id) => ComposerStore.getDraft(id).link !== null,
  doesDraftHaveRetweetAttachment: (id) => ComposerStore.getDraft(id).retweet !== null,
  doesDraftHaveAttachmentEnabled: (id) => ComposerStore.getDraft(id).enabledAttachmentType !== null,
  doesDraftHaveLinkAttachmentEnabled: (id) =>
    ComposerStore.getDraft(id).enabledAttachmentType === AttachmentTypes.LINK,
  doesDraftHaveSourceLink: (id) => ComposerStore.getDraft(id).sourceLink !== null,

  isDraftLocked: (id) => ComposerStore.getDraft(id).isSaved,

  getDraftsSharedData: () => state.draftsSharedData,

  areAllDraftsSaved: () => {
    const enabledDrafts = ComposerStore.getEnabledDrafts();
    return enabledDrafts.length > 0 && enabledDrafts.every((draft) => draft.isSaved);
  },

  // Retrieve long link from shortLinkLongLinkMap (if url is long link already, return url)
  getCanonicalUrl: (url) => {
    const matchingDraft = state.drafts.find((draft) => draft.shortLinkLongLinkMap.has(url));
    if (matchingDraft) return matchingDraft.shortLinkLongLinkMap.get(url);

    return url;
  },

  // scheduledAt and isPinnedToSlot are the same across all drafts
  getScheduledAt: () => state.drafts[0].scheduledAt,
  isPinnedToSlot: () => state.drafts[0].isPinnedToSlot,

  getMeta: () => state.meta,

  /**
   * Do not use: synchronous "dispatches" go against Flux's ideas, this method
   * is only used in a single place to prevent a race condition.
   */
   // eslint-disable-next-line no-use-before-define
  _syncDispatch: (payload) => onDispatchedPayload(payload),
});

// Should be used for composition with functions that are passed a draft id as first argument.
// It would have been awesome to compose this as a decorator on top of non-class methods,
// alas this isn't part of the spec yet.
const monitorComposerLastInteractedWith = (fn) => (draftId, ...restArgs) => {
  if (draftId === 'omni' || draftId === AppStore.getAppState().expandedComposerId) {
    state.meta.lastInteractedWithComposerId = draftId;
  }

  return fn(draftId, ...restArgs);
};

const updateDraftErrorType = (id, errorType) =>
  (ComposerStore.getDraft(id).savingErrorType = errorType);

const clearDraftInlineErrors = (id) => {
  const notifications = NotificationStore.getVisibleNotifications().filter((notif) =>
    notif.scope === `${NotificationScopes.UPDATE_SAVING}-${ErrorTypes.INLINE}-${id}`
  );
  notifications.forEach((notif) => NotificationActionCreators.removeNotification(notif.id));
};

const enableDraft = monitorComposerLastInteractedWith(
  (id, markAppAsLoadedWhenDone) => {
    let shouldPreventRerender = false;

    if (ComposerStore.isDraftLocked(id)) return !shouldPreventRerender;

    /**
     * Dashboard-specific rules:
     * - If omnibox is disabled, and there's only a single and empty composer currently
     *   enabled, then enabling a new draft will enable the omnibox, effectively keeping
     *   a single composer visible (the omnibox's)
     * - If omnibox is disabled, and there are multiple or non-empty composers currently
     *   enabled, then enabling a new draft will show an additional composer, which will
     *   be prefilled with the previous composer's contents
     */
    const { appEnvironment } = AppStore.getMetaData();
    const isDashboardEnv = appEnvironment === AppEnvironments.WEB_DASHBOARD;
    if (isDashboardEnv) {
      const { isOmniboxEnabled } = AppStore.getAppState();

      if (!isOmniboxEnabled) {
        const enabledDrafts = ComposerStore.getEnabledDrafts();
        const hasOneEmptyEnabledDraft =
          enabledDrafts.length === 1 && isDraftEmpty(enabledDrafts[0]);

        if (hasOneEmptyEnabledDraft) {
          AppActionCreators.updateOmniboxState(true);
          shouldPreventRerender = true;
        } else if (enabledDrafts.length >= 1) {
          copyDraftContents({
            draftFrom: ComposerStore.getDraft(state.meta.lastInteractedWithComposerId),
            draftsTo: [ComposerStore.getDraft(id)],
          });
        }
      }
    }

    ComposerStore.getDraft(id).isEnabled = true;

    if (markAppAsLoadedWhenDone) AppActionCreators.markAppAsLoaded();

    return !shouldPreventRerender;
  }
);

const disableDraft = (id) => {
  let shouldPreventRerender = false;

  if (ComposerStore.isDraftLocked(id)) return !shouldPreventRerender;
  ComposerStore.getDraft(id).isEnabled = false;

  // Disable omnibox mode if needed
  const { isOmniboxEnabled } = AppStore.getAppState();
  const enabledDrafts = ComposerStore.getEnabledDrafts();
  const hasOneEnabledDraft = enabledDrafts.length === 1;

  if (isOmniboxEnabled && hasOneEnabledDraft) {
    AppActionCreators.updateOmniboxState(false);
    copyDraftContents({ draftsTo: enabledDrafts });
    shouldPreventRerender = true;
  }

  NotificationActionCreators.removeComposerOmniboxNotices(id);

  return !shouldPreventRerender;
};

const getFirstNonNullOrUndefined = (...values) => (
  values.find((v) => typeof v !== 'undefined' && v !== null)
);

const handleDraftInitialTextMentions = (editorState, contentState) => {
  contentState.getBlockMap().forEach((contentBlock) => {
    prepopulatedMentionStrategy(
      contentBlock,
      (...indices) => {
        editorState = addEditorPrepopulatedMention(editorState, contentBlock, indices);
      }
    );
  });

  return editorState;
};

const handleDraftInitialTextHashtags = (editorState, contentState) => {
  contentState.getBlockMap().forEach((contentBlock) => {
    prepopulatedHashtagStrategy(
      contentBlock,
      (...indices) => {
        editorState = addEditorPrepopulatedHashtag(editorState, contentBlock, indices);
      }
    );
  });

  return editorState;
};

const handleDraftInitialFacebookMentions = (editorState, contentState, entities) => {
  entities.forEach(({ indices, ...entityData }) => {
    // Use a Map for entity data in order to expose a similar API as
    // draft-js-mention-plugin, which uses ImmutableJS
    const entityDataMap = new Map(Object.entries(entityData));

    editorState = addEditorImportedFacebookMention(editorState, indices, {
      mention: entityDataMap,
    });
  });

  return editorState;
};

const setDraftInitialText = ({
  id,
  text,
  url,
  facebookMentionEntities,
  via,
  composerInitiator,
  isEditingUpdate,
}) => {
  const draft = ComposerStore.getDraft(id);

  if (draft.enabledAttachmentType === AttachmentTypes.RETWEET) {
    const retweetMark = 'RT @';

    if (text.includes(retweetMark)) {
      text = text.substring(0, text.indexOf(` ${retweetMark}`));
      const hasRetweetComment = text.length !== 0;
      if (!hasRetweetComment) return;
    }
  }

  const shouldAppendUrl = (
    draft.service.name !== 'pinterest' &&
    (draft.service.name !== 'instagram' ||
     !ComposerInitiators.ImageBufferButtons.includes(composerInitiator))
  );

  const initialText = [
    text,
    shouldAppendUrl ? url : null,
    via ? `via @${via}` : null,
  ].filter((val) => val).join(' ');

  /**
   * willGetOverridenByOmnibox is a patch that serves to prevent the Facebook
   * text-prefilling notification below from showing up when MC starts with the
   * omnibox and other composers still get prefilled on load (hence queueing that
   * tooltip on load, despite the fact that the omnibox's contents will override
   * what was prefilled into Facebook anyway, making the tooltip unnecessary).
   * TODO: A better way of doing this will be to refactor how MC loads -> currently
   * all drafts are prefilled on load (omnibox and social networks); instead we'll
   * want only the omnibox to be prefilled, or only the social networks to be
   * prefilled if the omnibox isn't enabled. It'll be less wasteful, and will
   * remove the need for patches like willGetOverridenByOmnibox which should ideally
   * not exist. Most (if not all) actions created from loadInitialMetaData() will
   * need to be refactored to only target either the omnibox or the other drafts.
   */
  const willGetOverridenByOmnibox =
    AppStore.getAppState().isOmniboxEnabled && !draft.service.isOmni;

  if (
    draft.service.doesRequireHumanInteractionToUpdateText &&
    !isEditingUpdate &&
    !willGetOverridenByOmnibox
  ) {
    NotificationActionCreators.queueInfo({
      scope: `${NotificationScopes.COMPOSER_NOTICE_NOT_PREFILLED}-${draft.service.name}`,
      message: `<a href="https://faq.buffer.com/article/589-why-the-browser-extension-${''
                }doesnt-pull-in-text-for-facebook" className={styles.composerInfoMessageLink}
                target="_blank" rel="noopener noreferrer">Why is it necessary to manually
                enter a message for Facebook?</a>`,
      shouldOnlyCloseOnce: true,
    });
    return;
  }

  // Ensure only a single content block gets created by createFromText() by
  // splitting initialText with a regex that matches nothing
  const zeroMatchDelimiter = /$./;
  const contentState = ContentState.createFromText(initialText, zeroMatchDelimiter);

  let editorState = EditorState.createWithContent(contentState);
  editorState = EditorState.moveSelectionToEnd(editorState);

  const shouldEnableTwitterMentionAutocomplete = draft.service.name === 'twitter';
  if (shouldEnableTwitterMentionAutocomplete) {
    editorState = handleDraftInitialTextMentions(editorState, contentState);
  }

  const shouldEnableTwitterHashtagAutocomplete = draft.service.name === 'twitter';
  if (shouldEnableTwitterHashtagAutocomplete) {
    editorState = handleDraftInitialTextHashtags(editorState, contentState);
  }

  const shouldEnableFacebookMentionAutocomplete = draft.service.name === 'facebook';
  if (shouldEnableFacebookMentionAutocomplete && facebookMentionEntities !== null) {
    editorState =
      handleDraftInitialFacebookMentions(editorState, contentState, facebookMentionEntities);
  }

  draft.editorState = editorState;

  ComposerActionCreators.updateDraftCharacterCount(id);
};

const setDraftsInitialText = ({
  text,
  url,
  facebookMentionEntities,
  via,
  composerInitiator,
  isEditingUpdate,
}) => {
  state.drafts.forEach((draft) =>
    setDraftInitialText({
      id: draft.id,
      text,
      url,
      facebookMentionEntities,
      via,
      composerInitiator,
      isEditingUpdate,
    })
  );
};

const setDraftEditorState = monitorComposerLastInteractedWith(
  (id, editorState) => {
    ComposerStore.getDraft(id).editorState = editorState;
    ComposerActionCreators.updateDraftCharacterCount(id);
  }
);

const updateDraftIsSaved = (id) => {
  ComposerStore.getDraft(id).isSaved = true;
};

const debouncedUpdateDraftSourceLinkDataActionCreator = debounce((id, url) => {
  ComposerActionCreators.updateDraftSourceLinkData(id, url);
}, 250);

const updateDraftSourceLink = monitorComposerLastInteractedWith(
  (id, url) => {
    const draft = ComposerStore.getDraft(id);
    if (!draft.service.canHaveSourceUrl) return;

    if (url === '') {
      draft.sourceLink = null;
    } else {
      draft.sourceLink = getNewSourceLink(url);

      const isValidUrl = twitterText.isValidUrl(url, true, false);
      if (isValidUrl) debouncedUpdateDraftSourceLinkDataActionCreator(id, url);
    }
  }
);

const updateDraftSourceLinkData = (id, { url, images = [] }) => {
  if (!ComposerStore.doesDraftHaveSourceLink(id)) return;

  const draftSourceLink = ComposerStore.getDraft(id).sourceLink;

  Object.assign(draftSourceLink, {
    url,
    availableImages: images.map((image) => getNewImage(image.url, image.width, image.height)),
  });
};

const updateDraftScheduledAt = monitorComposerLastInteractedWith(
  (id, timestamp, isPinnedToSlot = false) => {
    const draft = ComposerStore.getDraft(id);
    draft.scheduledAt = timestamp;
    draft.isPinnedToSlot = isPinnedToSlot;
  }
);

const getDraftCharacterCount = (id, text) => {
  const draft = ComposerStore.getDraft(id);

  if (draft.service.name === 'twitter') {
    const mockAttachmentLink = 'https://pbs.twimg.com/media/XXXXXX';
    const mockAttachmentText = ` ${mockAttachmentLink}`;

    if (draft.enabledAttachmentType === AttachmentTypes.MEDIA) {
      if (draft.video !== null) {
        const willVideoBeNativeOnTwitter =
          draft.video.size < draft.service.nativeVideoSizeLimit &&
          draft.video.durationMs < draft.service.nativeVideoDurationLimit * 1000;
        const willVideoLinkBeAddedToText = !willVideoBeNativeOnTwitter;

        if (willVideoLinkBeAddedToText) text += mockAttachmentText;
      }
    }

    return twitterText.getTweetLength(text);
  }

  if (draft.service.name === 'instagram') {
    return text.length;
  }

  if (draft.service.name === 'pinterest') {
    let charCount = text.length;
    if (draft.enabledAttachmentType === AttachmentTypes.MEDIA && draft.video !== null) {
      charCount += 52;
    }
    return charCount;
  }

  if (draft.service.name === 'linkedin') {
    let charCount = text.length;

    const urls = twitterText.extractUrls(text);
    const hasLinkAttached =
      draft.enabledAttachmentType === AttachmentTypes.LINK && draft.link !== null;

    // Add 24 chars for images and videos
    if (draft.enabledAttachmentType === AttachmentTypes.MEDIA) {
      if (draft.images.length > 0) charCount += 24;
      if (draft.video !== null) charCount += 24;
    }

    // Add 24 chars for link
    if (hasLinkAttached) charCount += 24;

    // If there are urls in the text, subtract the url length from the charCount
    // and add back 24 chars for each url
    if (urls.length > 0) {
      let accountedForUrlsCount = urls.length;
      let totalUrlLength = 0;

      // Don't count url if it's the link url
      const isAttachedLinkInText = hasLinkAttached && urls.includes(draft.link.url);
      if (isAttachedLinkInText) accountedForUrlsCount--;

      for (const url of urls) {
        totalUrlLength += url.length;
      }

      charCount -= totalUrlLength;
      charCount += accountedForUrlsCount * 24;
    }

    return charCount;
  }

  throw new Error('No character counting rules implemented for this service');
};

const updateDraftCharacterCount = monitorComposerLastInteractedWith(
  (id, didEditorStateChange) => {
    const draft = ComposerStore.getDraft(id);
    if (draft.service.charLimit === null) return;

    const draftText = ComposerStore.getDraftText(id);
    draft.characterCount = getDraftCharacterCount(id, draftText);

    // If the character count was updated as a result of a change that didn't
    // originate from the editor itself, we need to give the editor an opportunity
    // to re-render the highlighter's decorator ourselves. A prop is used to tell
    // the editor to re-render decorators. The editor itself sets that prop back
    // to false using the draft reference.
    if (!didEditorStateChange) draft.forceDecoratorsRerender = true;
  }
);

const mapShortLinkWithLongLink = (id, shortLink, longLink) => {
  const draft = ComposerStore.getDraft(id);
  draft.shortLinkLongLinkMap.set(shortLink, longLink);
};

const unmapShortLinkWithLongLink = (id, link) => {
  const draft = ComposerStore.getDraft(id);
  draft.shortLinkLongLinkMap.delete(link);
};

/**
 * Loop over each block of text in the editor, and update the list of all urls
 * within the composer + detect new and removed ones
 */
const parseDraftTextLinks = (id) => {
  const draft = ComposerStore.getDraft(id);
  const contentState = draft.editorState.getCurrentContent();
  const parsedUrls = [];

  contentState.getBlockMap().forEach((contentBlock) => {
    const text = contentBlock.getText();
    const parsedUrlsWithIndices = twitterText.extractUrlsWithIndices(text);

    parsedUrls.push(...parsedUrlsWithIndices.map((urlWithIndices) => urlWithIndices.url));
  });

  const newUrls = parsedUrls.filter((url) => !draft.urls.includes(url));
  const removedUrls = draft.urls.filter((url) => !parsedUrls.includes(url));

  draft.urls = parsedUrls;

  if (newUrls.length) ComposerActionCreators.handleNewDraftLinks(id, newUrls);
  if (removedUrls.length) ComposerActionCreators.handleRemovedDraftLinks(id, removedUrls);

  if (newUrls.length || removedUrls.length) ComposerActionCreators.updateDraftCharacterCount(id);
};

const handleNewDraftLinks = (id, newUrls) => {
  const draft = ComposerStore.getDraft(id);

  // If link attachment is disabled, update it with first newly-added url
  if (!ComposerStore.doesDraftHaveLinkAttachmentEnabled(id)) {
    ComposerActionCreators.updateDraftLink(id, newUrls[0]);

    // If no attachment is currently enabled, bring link attachment up with new link
    if (!ComposerStore.doesDraftHaveAttachmentEnabled(id)) {
      ComposerActionCreators.toggleAttachment(id, AttachmentTypes.LINK);
    }
  }

  // Shorten newly-added links if not unshortened before
  newUrls.forEach((newUrl) => {
    const wasUnshortenedBefore = draft.unshortenedUrls.includes(newUrl);
    if (!wasUnshortenedBefore) ComposerActionCreators.shortenDraftLink(id, newUrl);
  });

  // Add images scraped from new links to list of available images
  newUrls.forEach((newUrl) => ComposerActionCreators.updateDraftLinkAvailableImages(id, newUrl));
};

const handleRemovedDraftLinks = (id, removedUrls) => {
  const draft = ComposerStore.getDraft(id);

  removedUrls.forEach((removedUrl) => {
    // Remove from available images those whose source link has been removed
    ComposerActionCreators.removeDraftLinkAvailableImages(id, removedUrl);

    // Forget this link was possibly unshortened before to allow shortening it
    // again if re-added
    const unshortenedUrlIndex = draft.unshortenedUrls.indexOf(removedUrl);
    if (unshortenedUrlIndex !== -1) draft.unshortenedUrls.splice(unshortenedUrlIndex, 1);

    unmapShortLinkWithLongLink(id, removedUrl);
  });
};

/**
 * One-stop shop for updating draft link data. When a new link attachment is created,
 * if a piece of link attachment data that could be retrieved from the scraper is
 * missing, the scraper will be automatically invoked to retrieve more data.
 *
 * @param {string} id - Draft id
 * @param {object} linkData - Contains any number of link data properties
 * @param {object} meta
 * @param {boolean} meta.isNewLinkAttachment - Whether a new link is being attached,
 *                                             or an existing one being updated
 * @param {boolean} meta.comesFromDirectUserAction - Whether e.g. a keypress led to
 *                                                   linkData being updated
 *
 * The values from both meta.isNewLinkAttachment and meta.comesFromDirectUserAction
 * will determine how linkData is used. If meta.isNewLinkAttachment is true, linkData
 * will replace all previous values, and missing data will be reset to null. If it's
 * false, then linkData will be composed onto the existing link attachment's data.
 * Some properties can be customized by users and are valuable to keep around when new
 * link attachement data is set (e.g. after scraping a link). That's the case of
 * link.title, link.description, and link.thumbnail. When meta.comesFromDirectUserAction
 * is false, these properties will never be overridden by new linkData. When it's true,
 * these properties will always take new values from new linkData (if provided).
 *
 * Example usage:
 *
 * 1. Creating a new empty link attachment:
 *
 *    updateDraftLinkData(id, { url }, {
 *      isNewLinkAttachment: true,
 *      comesFromDirectUserAction: false,
 *    })
 *
 * 2. Updating a link attachment's title when users manually edit it:
 *
 *    updateDraftLinkData(id, { title }, {
 *      isNewLinkAttachment: false,
 *      comesFromDirectUserAction: true,
 *    })
 *
 * 3. Update a link attachment's data after scraping the page:
 *
 *    updateDraftLinkData(id, scrapedData, {
 *      isNewLinkAttachment: false,
 *      comesFromDirectUserAction: false,
 *    })
 */
const updateDraftLinkData = monitorComposerLastInteractedWith(
  (id, linkData, meta) => {
    const { isNewLinkAttachment, comesFromDirectUserAction } = meta;
    const draft = ComposerStore.getDraft(id);

    const {
      url = null, title = null, description = null, thumbnail = null,
      availableThumbnails = null,
    } = linkData;

    if (!draft.service.canHaveAttachmentType(AttachmentTypes.LINK)) return;

    const hasLinkAttachment = draft.link !== null;
    const hasAvailableThumbnails = availableThumbnails !== null && availableThumbnails.length > 0;
    const fallBackToLinkAttachmentData = !isNewLinkAttachment && hasLinkAttachment;
    const prioritizeLinkAttachmentData = fallBackToLinkAttachmentData && !comesFromDirectUserAction;

    // In some situations (e.g. editing an update that has a custom thumbnail in the dashboard),
    // an attached thumbnail won't be found among the scraped availableThumbnails: this flag is used
    // to know when to insert such an attached thumbnail into the collection of availableThumbnails
    // so that navigating between available thumbnails doesn't lose this initial thumbnail.
    const hasUnavailableThumbnailAttached = (
      draft.link !== null && draft.link.thumbnail !== null && availableThumbnails !== null &&
      !availableThumbnails.some((thumb) => thumb.url === draft.link.thumbnail.url)
    );

    draft.link = getNewLink({
      url: getFirstNonNullOrUndefined(
        url,
        fallBackToLinkAttachmentData ? draft.link.url : null
      ),
      title: getFirstNonNullOrUndefined(
        prioritizeLinkAttachmentData ? draft.link.title : null,
        title !== null ? title.replace(/\n/g, '') : null, // Strip out line breaks
        fallBackToLinkAttachmentData ? draft.link.title : null
      ),
      description: getFirstNonNullOrUndefined(
        prioritizeLinkAttachmentData ? draft.link.description : null,
        description,
        fallBackToLinkAttachmentData ? draft.link.description : null
      ),
      thumbnail: getFirstNonNullOrUndefined(
        thumbnail !== null ? getNewImage(thumbnail) : null,
        fallBackToLinkAttachmentData ? draft.link.thumbnail : null,
        (hasAvailableThumbnails ?
          getNewImage(
            availableThumbnails[0].url,
            availableThumbnails[0].width,
            availableThumbnails[0].height
          ) :
          null)
      ),
      thumbnailHttps: null,
      availableThumbnails: getFirstNonNullOrUndefined(
        (availableThumbnails !== null ?
          [
            ...(hasUnavailableThumbnailAttached ? [draft.link.thumbnail] : []),
            ...availableThumbnails.map((thumb) => getNewImage(thumb.url, thumb.width, thumb.height)),
          ] :
          null),
        fallBackToLinkAttachmentData ? draft.link.availableThumbnails : null
      ),
      wasEdited:
        (isNewLinkAttachment ?
          false :
          comesFromDirectUserAction || !!(draft.link && draft.link.wasEdited)),
    });

    // If the link is missing some data that we could retrieve by scraping it, do so
    const scrapableProps = ['title', 'description', 'availableThumbnails'];
    const isAnyScrapablePropMissing = scrapableProps.some((prop) => draft.link[prop] === null);
    if (isAnyScrapablePropMissing) ComposerActionCreators.scrapeDraftLinkData(id, url);
  }
);

const updateDraftFileUploadProgress = (id, progress) => {
  ComposerStore.getDraft(id).fileUploadProgress = progress;
};

const addDraftImage = monitorComposerLastInteractedWith(
  (id, image) => {
    const draft = ComposerStore.getDraft(id);
    const hasMaxAttachableImages = draft.images.length >= draft.service.maxAttachableImagesCount;
    const hasAttachedVideo = draft.video !== null;
    const hasAttachedGif = draft.gif != null;

    if (!draft.service.canHaveAttachmentType(AttachmentTypes.MEDIA)) return;
    if (!draft.service.canHaveMediaAttachmentType(MediaTypes.IMAGE)) return;

    if (hasMaxAttachableImages) draft.images.pop(); // Override last image
    if (hasAttachedVideo) draft.video = null; // Override video
    if (hasAttachedGif) draft.gif = null; // Override gif

    draft.images.push(image);

    ComposerActionCreators.draftImageAdded(id, image.url);
    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

const updateDraftLinkThumbnail = monitorComposerLastInteractedWith(
  (id, thumbnail) => {
    const draft = ComposerStore.getDraft(id);
    draft.link.thumbnail = thumbnail;
    draft.link.thumbnailHttps = thumbnail.url;

    // TODO: merge updateDraftLinkThumbnail() into updateDraftLinkData()
    draft.link.wasEdited = true;
  }
);

const selectNextLinkThumbnail = monitorComposerLastInteractedWith(
  (draftId) => {
    const draft = ComposerStore.getDraft(draftId);
    const availableThumbnails = draft.link.availableThumbnails;
    const currThumbnailIndex = findLastIndexOf(availableThumbnails, (thumbnail) =>
      thumbnail.url === draft.link.thumbnail.url);
    let nextThumbnail;

    if (currThumbnailIndex === availableThumbnails.length - 1) {
      nextThumbnail = availableThumbnails[0];
    } else {
      nextThumbnail = availableThumbnails[currThumbnailIndex + 1];
    }

    ComposerActionCreators.updateDraftLinkThumbnail(draftId, nextThumbnail);
  }
);

const selectPreviousLinkThumbnail = monitorComposerLastInteractedWith(
  (draftId) => {
    const draft = ComposerStore.getDraft(draftId);
    const availableThumbnails = draft.link.availableThumbnails;
    const currThumbnailIndex = availableThumbnails.findIndex((thumbnail) =>
      thumbnail.url === draft.link.thumbnail.url
    );
    let prevThumbnail;

    if (currThumbnailIndex === 0) {
      prevThumbnail = availableThumbnails[availableThumbnails.length - 1];
    } else {
      prevThumbnail = availableThumbnails[currThumbnailIndex - 1];
    }

    ComposerActionCreators.updateDraftLinkThumbnail(draftId, prevThumbnail);
  }
);

const addDraftLinkAvailableThumbnail = (id, thumbnail) => {
  const draft = ComposerStore.getDraft(id);
  if (draft.link.availableThumbnails === null) draft.link.availableThumbnails = [];
  draft.link.availableThumbnails.unshift(thumbnail);
};

const addDraftUploadedLinkThumbnail = (id, url, width, height) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const formattedImage = getNewImage(url, width, height);

  /**
   * It's important for the three collections below to share the same formattedImage
   * reference, so that a change made in one location propagates to all other places
   * seamlessly.
   * TODO: Re-implement this logic in an immutable fashion: it'll be a bit more work
   * to manually search and update all places where an image can be stored, but it'll
   * be much more solid.
   */
  updateDraftLinkThumbnail(id, formattedImage);
  addDraftLinkAvailableThumbnail(id, formattedImage);
  draftsSharedData.uploadedImages.push(formattedImage);
};

const addDraftUploadedImage = (draftId, url, width, height) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const formattedImage = getNewImage(url, width, height);

  /**
   * It's important for the two collections below to share the same formattedImage
   * reference, so that a change made in one location propagates to all other places
   * seamlessly.
   * TODO: Re-implement this logic in an immutable fashion: it'll be a bit more work
   * to manually search and update all places where an image can be stored, but it'll
   * be much more solid.
   */
  draftsSharedData.uploadedImages.push(formattedImage);
  addDraftImage(draftId, formattedImage);
};

const addAutoUploadedImage = (url, altText) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const formattedImage = getNewImage(url, null, null, altText);

  /**
   * It's important for the two collections below to share the same formattedImage
   * reference, so that a change made in one location propagates to all other places
   * seamlessly.
   * TODO: Re-implement this logic in an immutable fashion: it'll be a bit more work
   * to manually search and update all places where an image can be stored, but it'll
   * be much more solid.
   */
  draftsSharedData.uploadedImages.push(formattedImage);
  state.drafts.forEach((draft) => addDraftImage(draft.id, formattedImage));
};

const removeDraftImage = monitorComposerLastInteractedWith(
  (id, image) => {
    const draft = ComposerStore.getDraft(id);
    const imageIndex = draft.images.indexOf(image);

    draft.images.splice(imageIndex, 1);

    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

// TODO: Refactor to not rely on reference mutations
const updateImageAltText = (image, altText) => {
  image.altText = altText;
};

/**
 * TODO: Refactor to not rely on reference mutations
 * This method is currently only called when auto-uploading images (i.e. auto-attached
 * images on app load), so the two collections where we're sure to be able to find
 * them at any point in time are draftsSharedData.uploadedImages/uploadedGifs.
 * Find the image there and mutate it. This is quite brittle, hence the todo above.
 */
const updateUploadedImageDimensions = (url, width, height) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const collections = [draftsSharedData.uploadedImages, draftsSharedData.uploadedGifs];
  let image;

  collections.some((imageCollection) => (
    image = imageCollection.find((uploadedImage) => uploadedImage.url === url)
  ));

  image.width = width;
  image.height = height;
};

/**
 * Note: When adding to the draft a video that already exists within the app, it's
 * important to pass the video object's reference around rather than creating a new
 * equivalent video object, since those references are compared in different places
 * using === to establish if we're looking at the same video or not.
 */
const addDraftVideo = monitorComposerLastInteractedWith(
  (id, { video, thumbnail = null }) => {
    const draft = ComposerStore.getDraft(id);
    const hasAttachedImages = draft.images.length > 0;
    const hasAttachedVideo = draft.video !== null;
    const hasAttachedGif = draft.gif !== null;

    if (!draft.service.canHaveAttachmentType(AttachmentTypes.MEDIA)) return;
    if (!draft.service.canHaveMediaAttachmentType(MediaTypes.VIDEO)) return;

    if (hasAttachedImages) draft.images.splice(0); // Override images
    if (hasAttachedVideo) draft.video = null; // Override video
    if (hasAttachedGif) draft.gif = null;

    draft.video = cloneDeep(video);
    draft.videoThumbnailPickerPayload = null;
    if (thumbnail !== null) draft.video.thumbnail = thumbnail;

    ComposerActionCreators.draftVideoAdded(id, video);
    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

const addSharedUploadedVideo = (videoData) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  draftsSharedData.uploadedVideos.push(videoData);
};

const finishAddingProcessedVideo = (videoData) => {
  const processingVideos = state.draftsSharedData.processingVideos;

  if (!processingVideos.has(videoData.uploadId)) return;

  const draftId = processingVideos.get(videoData.uploadId);
  const video = getNewVideo(videoData);

  addDraftVideo(draftId, { video });
  addSharedUploadedVideo(video);
  updateDraftFileUploadProgress(draftId, null);
};

const removeDraftVideo = monitorComposerLastInteractedWith(
  (id) => {
    ComposerStore.getDraft(id).video = null;
    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

const addDraftGif = monitorComposerLastInteractedWith(
  (id, gif) => {
    const draft = ComposerStore.getDraft(id);
    const hasAttachedImages = draft.images.length > 0;
    const hasAttachedVideo = draft.video !== null;

    if (!draft.service.canHaveAttachmentType(AttachmentTypes.MEDIA)) return;
    if (!draft.service.canHaveMediaAttachmentType(MediaTypes.GIF)) return;

    if (hasAttachedImages) draft.images.splice(0); // Override images
    if (hasAttachedVideo) draft.video = null; // Override video
    draft.gif = gif;
    ComposerActionCreators.draftGifAdded(id, gif.url);
    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

const addDraftUploadedGif = (draftId, url, stillGifUrl, width, height) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const formattedGif = getNewGif(url, stillGifUrl, width, height);

  /**
   * It's important for the two collections below to share the same formattedGif
   * reference, so that a change made in one location propagates to all other places
   * seamlessly.
   * TODO: Re-implement this logic in an immutable fashion: it'll be a bit more work
   * to manually search and update all places where an image can be stored, but it'll
   * be much more solid.
   */
  draftsSharedData.uploadedGifs.push(formattedGif);
  addDraftGif(draftId, formattedGif);
};

const addAutoUploadedGif = (url, stillGifUrl) => {
  const draftsSharedData = ComposerStore.getDraftsSharedData();
  const formattedGif = getNewGif(url, stillGifUrl);

  /**
   * It's important for the two collections below to share the same formattedGif
   * reference, so that a change made in one location propagates to all other places
   * seamlessly.
   * TODO: Re-implement this logic in an immutable fashion: it'll be a bit more work
   * to manually search and update all places where an image can be stored, but it'll
   * be much more solid.
   */
  draftsSharedData.uploadedGifs.push(formattedGif);
  state.drafts.forEach((draft) => addDraftGif(draft.id, formattedGif));
};

const removeDraftGif = monitorComposerLastInteractedWith(
  (id) => {
    ComposerStore.getDraft(id).gif = null;
    ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
  }
);

const addDraftProcessingVideo = (draftId, uploadId) => {
  state.draftsSharedData.processingVideos.set(uploadId, draftId);
};

// This method can be called very often (onMouseMove), so make sure the store
// only emits a change if a change actually happened to prevent over-rendering
const updateDraftTempImage = (id, url) => {
  const draft = ComposerStore.getDraft(id);

  if (draft.tempImage !== url) {
    draft.tempImage = url;
    return true;
  }

  return false;
};

// Remove draft temp image in all cases if no image is specified, otherwise only
// remove the passed draft temp image if it's specified
const removeDraftTempImage = (id, url = null) => {
  if (url === null || ComposerStore.getDraft(id).tempImage === url) {
    updateDraftTempImage(id, null);
  }
};

const updateDraftVideoThumbnailPickerPayload = (id, video) => {
  ComposerStore.getDraft(id).videoThumbnailPickerPayload = video;
};

const updateDraftVideoThumbnailPickerPayloadThumbnail = (id, thumbnail) => {
  ComposerStore.getDraft(id).videoThumbnailPickerPayload.thumbnail = thumbnail;
};

const addDraftRetweet = (id, retweetData) => {
  const draft = ComposerStore.getDraft(id);

  if (!draft.service.canHaveAttachmentType(AttachmentTypes.RETWEET)) return;

  const retweet = getNewRetweet(retweetData);
  draft.retweet = retweet;

  ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
};

const disableDraftAttachment = (id) => {
  const draft = ComposerStore.getDraft(id);
  draft.enabledAttachmentType = null;

  ComposerActionCreators.attachmentToggled(id);
  ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
};

const enableDraftAttachment = (id, attachmentType) => {
  const draft = ComposerStore.getDraft(id);

  if (!draft.service.canHaveAttachmentType(attachmentType)) return;

  // Link Attachment doesn't have a suggestion mode: don't enable it if no link attached
  if (attachmentType === AttachmentTypes.LINK && !ComposerStore.doesDraftHaveLinkAttachment(id)) {
    return;
  }

  // Retweet Attachment doesn't have a suggestion mode: don't enable it if no retweet attached
  if (attachmentType === AttachmentTypes.RETWEET &&
    !ComposerStore.doesDraftHaveRetweetAttachment(id)) {
    return;
  }

  draft.enabledAttachmentType = attachmentType;

  ComposerActionCreators.attachmentToggled(id);
  ComposerActionCreators.updateDraftCharacterCount(id, { didEditorStateChange: false });
};

const toggleDraftAttachment = monitorComposerLastInteractedWith(
  (id, attachmentType) => {
    const draft = ComposerStore.getDraft(id);
    const shouldDisableAttachment = (draft.enabledAttachmentType === attachmentType);

    if (shouldDisableAttachment) {
      disableDraftAttachment(id);
    } else {
      enableDraftAttachment(id, attachmentType);
    }
  }
);

const replaceDraftLinkWithShortlink = (id, link, shortLink) => {
  const draft = ComposerStore.getDraft(id);
  let editorState = draft.editorState;
  const contentState = editorState.getCurrentContent();

  contentState.getBlockMap().forEach((contentBlock) => {
    const text = contentBlock.getText();
    const parsedUrlsWithIndices = twitterText.extractUrlsWithIndices(text);
    const parsedUrl =
      parsedUrlsWithIndices.find((urlWithIndices) => urlWithIndices.url === link);

    if (!parsedUrl) return;

    // The shorten endpoint also handles utm params, so what we think is a short link
    // could also be a long link with utm params added, depending on the user's prefs!
    // Differentiate between the two, and use the appropriate modifier :)
    const bareLink = link.replace(/(\?|#).*$/, ''); // Strip query + fragment for proper comparison
    const isReallyShortLink = !shortLink.includes(bareLink);

    if (isReallyShortLink) {
      editorState = addEditorShortLink(editorState, contentBlock, {
        link,
        shortLink,
        indices: parsedUrl.indices,
      });
    } else {
      editorState = replaceEditorLink(editorState, contentBlock, {
        oldLink: link,
        newLink: shortLink,
        indices: parsedUrl.indices,
      });
    }
  });

  draft.editorState = editorState;

  ComposerActionCreators.parseDraftTextLinks(id);
};


const addDraftUnshortenedLink = (id, unshortenedLink) => {
  const draft = ComposerStore.getDraft(id);
  draft.unshortenedUrls.push(unshortenedLink);
};

const addDraftAvailableImages = (id, images, sourceLink) => {
  const draft = ComposerStore.getDraft(id);

  const newAvailableImages = images.map((image) => {
    const formattedImage = getNewImage(image.url, image.width, image.height);
    return getNewAvailableImage(formattedImage, sourceLink);
  });

  draft.availableImages = draft.availableImages.concat(newAvailableImages);
};

const removeDraftAvailableImages = (id, sourceLink) => {
  const draft = ComposerStore.getDraft(id);

  draft.availableImages = draft.availableImages.filter((availableImage) =>
    availableImage.sourceLink !== sourceLink);
};

const addOmniNotice = (message, draftId) => {
  NotificationActionCreators.queueInfo({
    scope: NotificationScopes.MC_OMNIBOX_EDIT_NOTICE,
    message,
    shouldOnlyCloseOnce: false,
    data: { id: draftId, type: 'notice' },
  });
};

const getEditedImagesMessage = (service) => {
  let message;
  if (service.maxAttachableImagesCount === 1) {
    message = `${service.formattedName} only allows one image, so we used your first image :)`;
  } else {
    message = `${service.formattedName} only allows ${service.maxAttachableImagesCount}
    images, so we kept the first ${service.maxAttachableImagesCount} images :)`;
  }
  return message;
};

const copyDraftMedia = (draftFrom, draftTo) => {
  if (draftFrom.images.length > 0 && draftTo.service.canHaveMediaAttachmentType(MediaTypes.IMAGE)) {
    let imagesToAttach = draftFrom.images;
    if (draftFrom.images.length > draftTo.service.maxAttachableImagesCount) {
      imagesToAttach = draftFrom.images.slice(0, draftTo.service.maxAttachableImagesCount);
      const message = getEditedImagesMessage(draftTo.service);
      addOmniNotice(message, draftTo.id);
    }
    imagesToAttach.forEach((image) => addDraftImage(draftTo.id, image));
    enableDraftAttachment(draftTo.id, AttachmentTypes.MEDIA);
  } else if (draftFrom.gif !== null) {
    if (!draftTo.service.canHaveMediaAttachmentType(MediaTypes.GIF)) {
      const message = `${draftTo.service.formattedName} doesn't allow GIFs, so we've removed it for you!`;
      addOmniNotice(message, draftTo.id);
      return;
    }
    addDraftGif(draftTo.id, draftFrom.gif);
    enableDraftAttachment(draftTo.id, AttachmentTypes.MEDIA);
  } else if (draftFrom.video !== null) {
    if (!draftTo.service.canHaveMediaAttachmentType(MediaTypes.VIDEO)) {
      const message = `${draftTo.service.formattedName} doesn't allow videos, so we've removed it for you!`;
      addOmniNotice(message, draftTo.id);
      return;
    }
    addDraftVideo(draftTo.id, { video: draftFrom.video });
    enableDraftAttachment(draftTo.id, AttachmentTypes.MEDIA);
  }
};

const copyDraftTextData = (draftFrom, draftTo) => {
  const editorState =
    draftFrom.service.name === 'facebook' && draftTo.service.name !== 'facebook' ?
    removeFacebookAutocompleteEntities(draftFrom.editorState) : draftFrom.editorState;

  setDraftEditorState(draftTo.id, editorState);

  draftTo.urls = draftFrom.urls;
  draftTo.unshortenedUrls = draftFrom.unshortenedUrls;
  draftTo.shortLinkLongLinkMap = draftFrom.shortLinkLongLinkMap;
};

const copyDraftContents = ({
  draftFrom = ComposerStore.getDraft('omni'),
  draftsTo = state.drafts,
} = {}) => {
  draftsTo.forEach((draft) => {
    const service = draft.service;
    if (service.isOmni || draft === draftFrom) return;

    // eslint-disable-next-line no-use-before-define
    clearDraft(draft.id, { preserveEnabledState: true });

    // Add text and data related to text
    copyDraftTextData(draftFrom, draft);
    draft.sourceLink = draftFrom.sourceLink;

    draft.availableImages = draftFrom.availableImages;

    // Add attachments
    const enabledAttachmentType = draftFrom.enabledAttachmentType;
    if (enabledAttachmentType) {
      switch (enabledAttachmentType) {
        case AttachmentTypes.LINK: {
          if (!service.canHaveAttachmentType(enabledAttachmentType)) {
            const message = `${draft.service.formattedName} doesn't allow link attachments, so we removed it for you!`;
            addOmniNotice(message, draft.id);
            return;
          }

          if (!service.canEditLinkAttachment && draftFrom.link.wasEdited) {
            const message = `${draft.service.formattedName} doesn't allow editing links, so we kept the original link attachment for you!`;
            addOmniNotice(message, draft.id);
          }

          if (draftFrom.link !== null) {
            const linkDataToReuse = service.canEditLinkAttachment ? {
              url: draftFrom.link.url,
              title: draftFrom.link.title,
              description: draftFrom.link.description,
              thumbnail: draftFrom.link.thumbnail !== null ? draftFrom.link.thumbnail.url : null,
            } : {
              url: draftFrom.link.url,
            };

            updateDraftLinkData(draft.id, linkDataToReuse, {
              isNewLinkAttachment: true,
              comesFromDirectUserAction: false,
            });
            enableDraftAttachment(draft.id, AttachmentTypes.LINK);
          }

          break;
        }

        case AttachmentTypes.MEDIA: {
          if (!service.canHaveAttachmentType(enabledAttachmentType)) {
            const message = `${draft.service.formattedName} doesn't allow image attachments, so we removed the images for you!`;
            addOmniNotice(message, draft.id);
            return;
          }

          copyDraftMedia(draftFrom, draft);
          break;
        }

        case AttachmentTypes.RETWEET: {
          if (!service.canHaveAttachmentType(enabledAttachmentType)) {
            const message = `${draft.service.formattedName} doesn't allow retweet attachments, so we removed it for you!`;
            addOmniNotice(message, draft.id);
            return;
          }

          draft.retweet = draftFrom.retweet;
          break;
        }

        default:
          break;
      }
    }
  });

  // Let draftFrom remain the last active draft, so that networks that are added
  // immediately after still use the same draft as reference (instead of a
  // possibly more restricted other network, e.g. Twitter)
  state.meta.lastInteractedWithComposerId = draftFrom.id;
};

const clearDraft = (id, { preserveEnabledState = false } = {}) => {
  const draft = ComposerStore.getDraft(id);
  const emptyDraft = getNewDraft(draft.service);

  if (preserveEnabledState) emptyDraft.isEnabled = draft.isEnabled;

  Object.assign(draft, emptyDraft);
};

const clearOmniboxDraftWhenEnabling = (willBeEnabled) => {
  if (willBeEnabled) clearDraft('omni');
};

const parseDraftsTextLinks = () => {
  const enabledDrafts = ComposerStore.getEnabledDrafts();
  enabledDrafts.forEach((draft) => parseDraftTextLinks(draft.id));
};

const onDispatchedPayload = function(payload) {
  const action = payload.action;
  let shouldEmitChange = true;
  let video;

  switch (action.actionType) {
    case ActionTypes.COMPOSER_SET_DRAFTS_INITIAL_TEXT:
      setDraftsInitialText(action);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_EDITOR_STATE:
      setDraftEditorState(action.id, action.editorState);
      break;

    case ActionTypes.UPDATE_DRAFT_IS_SAVED:
      updateDraftIsSaved(action.id);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_CHARACTER_COUNT:
      updateDraftCharacterCount(action.id, action.didEditorStateChange);
      break;

    case ActionTypes.COMPOSER_PARSE_DRAFT_TEXT_LINKS:
      parseDraftTextLinks(action.id);
      break;

    case ActionTypes.COMPOSER_PARSE_DRAFTS_TEXT_LINKS:
      parseDraftsTextLinks();
      break;

    case ActionTypes.COMPOSER_HANDLE_NEW_DRAFT_TEXT_LINKS:
      handleNewDraftLinks(action.id, action.newUrls);
      break;

    case ActionTypes.COMPOSER_HANDLE_REMOVED_DRAFT_TEXT_LINKS:
      handleRemovedDraftLinks(action.id, action.removedUrls);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFTS_SCHEDULED_AT:
      state.drafts.forEach((draft) => {
        updateDraftScheduledAt(draft.id, action.scheduledAt, action.isPinnedToSlot);
      });
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_DATA:
      updateDraftLinkData(action.id, action.linkData, action.meta);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFTS_LINK_DATA:
      state.drafts.forEach((draft) =>
        updateDraftLinkData(draft.id, action.linkData, action.meta));
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_IMAGE:
      addDraftImage(action.id, action.image);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_THUMBNAIL:
      updateDraftLinkThumbnail(action.id, action.thumbnail);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_IMAGE:
      state.drafts.forEach((draft) => addDraftImage(draft.id, action.image));
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_GIF:
      state.drafts.forEach((draft) => addDraftGif(draft.id, action.gif));
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK:
      updateDraftSourceLink(action.id, action.url);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFTS_SOURCE_LINK:
      state.drafts.forEach((draft) => updateDraftSourceLink(draft.id, action.url));
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK_DATA:
      updateDraftSourceLinkData(action.id, action.linkData);
      break;

    case ActionTypes.COMPOSER_DRAFT_IMAGE_ADDED:
      removeDraftTempImage(action.id, action.url);
      break;

    case ActionTypes.COMPOSER_REMOVE_DRAFT_IMAGE:
      removeDraftImage(action.id, action.image);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_VIDEO:
      addDraftVideo(action.id, { video: action.video, thumbnail: action.thumbnail });
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_GIF:
      addDraftGif(action.id, action.gif);
      break;

    case ActionTypes.COMPOSER_DRAFT_VIDEO_ADDED:
      removeDraftTempImage(action.id, action.video.thumbnail);
      break;

    case ActionTypes.COMPOSER_DRAFT_GIF_ADDED:
      removeDraftTempImage(action.id, action.url);
      break;

    case ActionTypes.COMPOSER_REMOVE_DRAFT_VIDEO:
      removeDraftVideo(action.id, action.videoUrl);
      break;

    case ActionTypes.COMPOSER_REMOVE_DRAFT_GIF:
      removeDraftGif(action.id, action.gifUrl);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_TEMP_IMAGE:
      shouldEmitChange = updateDraftTempImage(action.id, action.url);
      break;

    case ActionTypes.COMPOSER_REMOVE_DRAFT_TEMP_IMAGE:
      removeDraftTempImage(action.id);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_VIDEO_THUMB_PICKER_PAYLOAD:
      updateDraftVideoThumbnailPickerPayload(action.id, action.video);
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFT_VIDEO_THUMB_PICKER_PAYLOAD_THUMB:
      updateDraftVideoThumbnailPickerPayloadThumbnail(action.id, action.thumbnail);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_RETWEET:
      state.drafts.forEach((draft) => addDraftRetweet(draft.id, action.retweetData));
      break;

    case ActionTypes.COMPOSER_TOGGLE_DRAFT_ATTACHMENT:
      toggleDraftAttachment(action.id, action.type);
      break;

    case ActionTypes.COMPOSER_ENABLE_DRAFTS_ATTACHMENT:
      state.drafts.forEach((draft) => enableDraftAttachment(draft.id, action.type));
      break;

    case ActionTypes.COMPOSER_ENABLE:
      shouldEmitChange = enableDraft(action.id, action.markAppAsLoadedWhenDone);
      break;

    case ActionTypes.COMPOSER_DISABLE:
      shouldEmitChange = disableDraft(action.id);
      break;

    case ActionTypes.UPDATE_DRAFT_ERROR_TYPE:
      updateDraftErrorType(action.id, action.errorType);
      break;

    case ActionTypes.COMPOSER_CLEAR_INLINE_ERRORS:
      clearDraftInlineErrors(action.id);
      break;

    case ActionTypes.COMPOSER_DRAFT_LINK_SHORTENED:
      monitorComposerLastInteractedWith(() => {
        replaceDraftLinkWithShortlink(action.id, action.link, action.shortLink);
        mapShortLinkWithLongLink(action.id, action.shortLink, action.link);
      })();
      break;

    case ActionTypes.COMPOSER_DRAFT_LINK_UNSHORTENED:
      monitorComposerLastInteractedWith(() => {
        addDraftUnshortenedLink(action.id, action.unshortenedLink);
        parseDraftTextLinks(action.id);
        unmapShortLinkWithLongLink(action.id, action.shortLink);
      })();
      break;

    case ActionTypes.COMPOSER_DRAFT_LINK_RESHORTENED:
      monitorComposerLastInteractedWith(() => {
        parseDraftTextLinks(action.id);
        mapShortLinkWithLongLink(action.id, action.shortLink, action.link);
      })();
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_AVAILABLE_IMAGES:
      addDraftAvailableImages(action.id, action.images, action.sourceLink);
      break;

    case ActionTypes.COMPOSER_REMOVE_DRAFT_AVAILABLE_IMAGES:
      removeDraftAvailableImages(action.id, action.sourceLink);
      break;

    case ActionTypes.COMPOSER_DRAFT_FILE_UPLOAD_STARTED:
      monitorComposerLastInteractedWith(() => {
        updateDraftFileUploadProgress(action.id, 0);
      })();
      break;

    case ActionTypes.COMPOSER_DRAFT_FILE_UPLOAD_PROGRESS:
      updateDraftFileUploadProgress(action.id, action.progress);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_IMAGE:
      addDraftUploadedImage(action.id, action.url, action.width, action.height);
      updateDraftFileUploadProgress(action.id, null);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_LINK_THUMBNAIL:
      addDraftUploadedLinkThumbnail(action.id, action.url, action.width, action.height);
      updateDraftFileUploadProgress(action.id, null);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_VIDEO:
      addDraftProcessingVideo(action.id, action.uploadId, action.name);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_GIF:
      addDraftUploadedGif(action.id, action.url, action.stillGifUrl, action.width, action.height);
      updateDraftFileUploadProgress(action.id, null);
      break;

    case ActionTypes.COMPOSER_VIDEO_PROCESSED:
      finishAddingProcessedVideo(action.processedVideoData);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_IMAGE:
      addAutoUploadedImage(action.url, action.altText);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_GIF:
      addAutoUploadedGif(action.url, action.stillGifUrl);
      break;

    case ActionTypes.COMPOSER_UPDATE_NEXT_LINK_THUMBNAIL:
      selectNextLinkThumbnail(action.draftId);
      break;

    case ActionTypes.COMPOSER_UPDATE_PREVIOUS_LINK_THUMBNAIL:
      selectPreviousLinkThumbnail(action.draftId);
      break;

    case ActionTypes.COMPOSER_UPDATE_IMAGE_ALT_TEXT:
      updateImageAltText(action.image, action.altText);
      break;

    case ActionTypes.COMPOSER_UPDATE_UPLOADED_IMAGE_DIMENSIONS:
      updateUploadedImageDimensions(action.url, action.width, action.height);
      break;

    case ActionTypes.COMPOSER_APPLY_OMNI_UPDATE:
      copyDraftContents();
      AppActionCreators.updateOmniboxState(false);
      break;

    case ActionTypes.APP_UPDATE_OMNIBOX_STATE:
      clearOmniboxDraftWhenEnabling(action.isEnabled);
      break;

    case ActionTypes.COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_VIDEO:
      video = getNewVideo(action.video);
      addSharedUploadedVideo(video);
      state.drafts.forEach((draft) => addDraftVideo(draft.id, { video }));
      break;

    case ActionTypes.COMPOSER_DRAFTS_PREVENT_AUTO_ATTACHING_URLS:
      state.drafts.forEach((draft) => { draft.urls = action.urls; });
      break;

    case ActionTypes.APP_RESET:
      state = getInitialState();
      break;

    default:
      shouldEmitChange = false;
      break;
  }

  if (shouldEmitChange) ComposerStore.emitChange();
};

AppDispatcher.register(onDispatchedPayload);

export default ComposerStore;
export { getDraftCharacterCount };
