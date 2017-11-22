import AppDispatcher from '../dispatcher';
import { ActionTypes, MediaTypes, NotificationScopes, UploadTypes } from '../AppConstants';
import AppStore from '../stores/AppStore';
import ComposerStore from '../stores/ComposerStore';
import Scraper from '../utils/Scraper';
import Shortener from '../utils/Shortener';
import Uploader from '../utils/Uploader';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import AppActionCreators from '../action-creators/AppActionCreators';
import { getStillDataUriFromGif } from '../utils/DOMUtils';
import { getFileTypeFromUrl } from '../utils/StringUtils';

const ComposerActionCreators = {

  enable: (id, markAppAsLoadedWhenDone = false) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_ENABLE,
      id,
      markAppAsLoadedWhenDone,
    });
  },

  disable: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DISABLE,
      id,
    });
  },

  expand: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_EXPAND,
      id,
    });
  },

  collapse: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_COLLAPSE,
      id,
    });
  },

  updateDraftHasSavingError: (id, hasSavingError) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.UPDATE_DRAFT_HAS_SAVING_ERROR,
      id,
      hasSavingError,
    });
  },

  updateDraftIsSaved: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.UPDATE_DRAFT_IS_SAVED,
      id,
    });
  },

  /**
   * Note: we're using a synchronous "dispatch" here, despite it not being
   * idiomatic, to prevent race conditions when updating the editor state:
   * if the state is updated in the editor component and takes some time to
   * reach the store because of an async dispatch, then any change made to
   * the editor state within the store during that time period will be lost.
   * This is the reason why this should be done synchronously.
   */
  updateDraftEditorState: (id, editorState) => {
    ComposerStore._syncDispatch({
      action: {
        actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_EDITOR_STATE,
        id,
        editorState,
      },
    });
  },

  updateDraftSourceLink: (id, url) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK,
      id,
      url,
    });
  },

  updateDraftSourceLinkData: (() => {
    let currentCanonicalUrl;

    return (id, url) => {
      const { environment } = AppStore.getMetaData();
      const canonicalUrl = ComposerStore.getCanonicalUrl(url);

      currentCanonicalUrl = canonicalUrl;

      Scraper.scrape(canonicalUrl, environment)
        .then((scrapedData) => {
          const doesScrapedDataStillMatchSourceUrl = currentCanonicalUrl === canonicalUrl;
          if (!doesScrapedDataStillMatchSourceUrl) return;

          const linkData = Object.assign({}, scrapedData, { url });
          AppDispatcher.handleViewAction({
            actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK_DATA,
            id,
            linkData,
          });
        });
    };
  })(),

  updateDraftCharacterCount: (id, { didEditorStateChange = true } = {}) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_CHARACTER_COUNT,
      id,
      didEditorStateChange,
    });
  },

  parseDraftTextLinks: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_PARSE_DRAFT_TEXT_LINKS,
      id,
    });
  },

  handleNewDraftLinks: (id, newUrls) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_HANDLE_NEW_DRAFT_TEXT_LINKS,
      id,
      newUrls,
    });
  },

  handleRemovedDraftLinks: (id, removedUrls) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_HANDLE_REMOVED_DRAFT_TEXT_LINKS,
      id,
      removedUrls,
    });
  },

  updateDraftLink: (id, url) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_DATA,
      id,
      linkData: { url },
      meta: {
        isNewLinkAttachment: true,
        comesFromDirectUserAction: false,
      },
    });

    AppActionCreators.trackUserAction(['composer', 'media', 'added_link']);
  },

  updateDraftLinkTitle: (id, title) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_DATA,
      id,
      linkData: { title },
      meta: {
        isNewLinkAttachment: false,
        comesFromDirectUserAction: true,
      },
    });
  },

  updateDraftLinkDescription: (id, description) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_DATA,
      id,
      linkData: { description },
      meta: {
        isNewLinkAttachment: false,
        comesFromDirectUserAction: true,
      },
    });
  },

  scrapeDraftLinkData: (id, url) => {
    const { environment } = AppStore.getMetaData();
    const canonicalUrl = ComposerStore.getCanonicalUrl(url);

    Scraper.scrape(canonicalUrl, environment)
      .then((scrapedData) => ({
        url,
        title: scrapedData.title || '',
        description: scrapedData.description || '',
        availableThumbnails: scrapedData.images || [],
      }))
      .then((linkData) => {
        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_DATA,
          id,
          linkData,
          meta: {
            isNewLinkAttachment: false,
            comesFromDirectUserAction: false,
          },
        });
      });
  },

  selectNextLinkThumbnail: (draftId) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_NEXT_LINK_THUMBNAIL,
      draftId,
    });
  },

  selectPreviousLinkThumbnail: (draftId) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_PREVIOUS_LINK_THUMBNAIL,
      draftId,
    });
  },

  shortenDraftLink: (id, url) => {
    const draft = ComposerStore.getDraft(id);

    // Use the first selected profile for link shortenig config
    // If omni, use the first selected profile or first connected profile
    // if no profiles are selected
    let profiles = [];
    if (draft.service.isOmni) {
      const enabledDrafts = ComposerStore.getEnabledDrafts();
      profiles = enabledDrafts.length > 0 ?
      AppStore.getSelectedProfilesForService(enabledDrafts[0].service.name) :
      AppStore.getProfiles();
    } else {
      profiles = draft.isEnabled ?
      AppStore.getSelectedProfilesForService(draft.service.name) :
      [];
    }

    if (profiles.length <= 0) return;
    const profileId = profiles[0].id;

    Shortener.shorten(profileId, url)
      .then((shortLink) => {
        // Don't create action when no new shortlink generated (can happen when url is already
        // a short link, or when link shortening is disabled for that profile)
        if (url === shortLink) return;

        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_DRAFT_LINK_SHORTENED,
          id,
          link: url,
          shortLink,
        });
      });
  },

  draftTextLinkUnshortened: (id, unshortenedLink) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_LINK_UNSHORTENED,
      id,
      unshortenedLink,
    });
  },

  draftTextLinkShortened: (id, unshortenedLink, shortLink) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_LINK_SHORTENED,
      id,
      link: unshortenedLink,
      shortLink,
    });
  },

  draftTextLinkReshortened: (id, unshortenedLink, shortLink) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_LINK_RESHORTENED,
      id,
      shortLink,
      link: unshortenedLink,
    });
  },

  updateDraftLinkAvailableImages: (id, url) => {
    const { environment } = AppStore.getMetaData();
    const canonicalUrl = ComposerStore.getCanonicalUrl(url);

    Scraper.scrape(canonicalUrl, environment)
      .then(({ images = [] }) => {
        if (images.length === 0) return;

        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_ADD_DRAFT_AVAILABLE_IMAGES,
          id,
          images,
          sourceLink: url,
        });
      });
  },

  removeDraftLinkAvailableImages: (id, sourceLink) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_REMOVE_DRAFT_AVAILABLE_IMAGES,
      id,
      sourceLink,
    });
  },

  toggleAttachment: (id, type) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_TOGGLE_DRAFT_ATTACHMENT,
      id,
      type,
    });
  },

  attachmentToggled: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_ATTACHMENT_TOGGLED,
      id,
    });
  },

  addDraftImage: (id, image) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_ADD_DRAFT_IMAGE,
      id,
      image,
    });
  },

  draftImageAdded: (id, url) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_IMAGE_ADDED,
      id,
      url,
    });
  },

  addDraftVideo: (id, video) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_ADD_DRAFT_VIDEO,
      id,
      video,
    });
  },

  addDraftGif: (id, gif) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_ADD_DRAFT_GIF,
      id,
      gif,
    });
  },

  updateDraftLinkThumbnail: (id, thumbnail) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_LINK_THUMBNAIL,
      id,
      thumbnail,
    });
  },

  updateDraftVideoThumbnail: (id, thumbnail) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_VIDEO_THUMBNAIL,
      id,
      thumbnail,
    });
  },

  updateDraftVideoTitle: (id, title) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_VIDEO_TITLE,
      id,
      title,
    });
  },

  draftVideoAdded: (id, video) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_VIDEO_ADDED,
      id,
      video,
    });
  },

  draftGifAdded: (id, url) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_GIF_ADDED,
      id,
      url,
    });
  },

  removeDraftImage: (id, image) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_REMOVE_DRAFT_IMAGE,
      id,
      image,
    });
  },

  removeDraftVideo: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_REMOVE_DRAFT_VIDEO,
      id,
    });
  },

  removeDraftGif: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_REMOVE_DRAFT_GIF,
      id,
    });
  },

  updateDraftTempImage: (id, url) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_TEMP_IMAGE,
      id,
      url,
    });
  },

  removeDraftTempImage: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_REMOVE_DRAFT_TEMP_IMAGE,
      id,
    });
  },

  updateDraftAttachedMediaEditingPayload: (id, media) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFT_ATTACHED_MEDIA_EDITING_PAYLOAD,
      id,
      media,
    });
  },

  uploadDraftFile: (id, file, uploadType) => {
    if (Uploader.isUploading()) Uploader.abort(); // Only one concurrent upload for now: abort first

    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_DRAFT_FILE_UPLOAD_STARTED,
      id,
    });

    Uploader.upload(file)
      .then((uploadedFile) => {
        if (uploadedFile.success === false) {
          NotificationActionCreators.queueError({
            scope: NotificationScopes.FILE_UPLOAD,
            message: 'Uh oh! It looks like we had an issue connecting to our' +
                     ' servers. Up for trying again?',
          });
        }

        if (uploadType === UploadTypes.LINK_THUMBNAIL) {
          AppDispatcher.handleViewAction({
            actionType: ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_LINK_THUMBNAIL,
            id,
            url: uploadedFile.url,
            width: uploadedFile.width,
            height: uploadedFile.height,
          });

          AppActionCreators.trackUserAction(['composer', 'thumbnail', 'uploaded_file'], {
            extension: getFileTypeFromUrl(uploadedFile.url),
          });
        } else {
          switch (uploadedFile.type) {
            case MediaTypes.IMAGE:
              AppDispatcher.handleViewAction({
                actionType: ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_IMAGE,
                id,
                url: uploadedFile.url,
                location,
                width: uploadedFile.width,
                height: uploadedFile.height,
              });
              AppActionCreators.trackUserAction(['composer', 'media', 'uploaded', 'photo'], {
                extension: getFileTypeFromUrl(uploadedFile.url),
              });
              AppActionCreators.trackUserAction(['composer', 'media', 'added_photo'], {
                addedFrom: 'upload',
                isGif: false,
              });
              break;

            case MediaTypes.VIDEO:
              AppDispatcher.handleViewAction({
                actionType: ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_VIDEO,
                id,
                uploadId: uploadedFile.uploadId,
                name: uploadedFile.name,
              });
              AppActionCreators.trackUserAction(['composer', 'media', 'uploaded', 'video'], {
                extension: uploadedFile.fileExtension,
              });
              break;

            case MediaTypes.GIF:
              getStillDataUriFromGif(uploadedFile.url)
                .then((dataUri) => {
                  AppDispatcher.handleViewAction({
                    actionType: ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_GIF,
                    id,
                    url: uploadedFile.url,
                    stillGifUrl: dataUri,
                    width: uploadedFile.width,
                    height: uploadedFile.height,
                  });
                })
                .catch(() => {
                  AppDispatcher.handleViewAction({
                    actionType: ActionTypes.COMPOSER_ADD_DRAFT_UPLOADED_GIF,
                    id,
                    url: uploadedFile.url,
                    stillGifUrl: null,
                    width: uploadedFile.width,
                    height: uploadedFile.height,
                  });
                });
              AppActionCreators.trackUserAction(['composer', 'media', 'uploaded', 'photo'], {
                extension: getFileTypeFromUrl(uploadedFile.url),
              });
              AppActionCreators.trackUserAction(['composer', 'media', 'added_photo'], {
                addedFrom: 'upload',
                isGif: true,
              });
              break;

            default:
              break;
          }
        }
      })
      .catch(() => {
        NotificationActionCreators.queueError({
          scope: NotificationScopes.FILE_UPLOAD,
          message: 'Uh oh! It looks like we had an issue connecting to our ' +
                   'servers. Up for trying again?',
        });
      });

    ComposerActionCreators.monitorDraftFileUploadProgress(id);
  },

  updateImageAltText: (image, altText) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_IMAGE_ALT_TEXT,
      image,
      altText,
    });
  },

  monitorDraftFileUploadProgress: async (id) => {
    const progressIterator = Uploader.getProgressIterator();
    let item;

    while (!(item = progressIterator.next()).done) { // eslint-disable-line no-cond-assign
      const promisedProgress = item.value;

      await promisedProgress.then((progress) => { // eslint-disable-line no-await-in-loop
        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_DRAFT_FILE_UPLOAD_PROGRESS,
          id,
          progress,
        });
      });
    }
  },

  applyOmniUpdate: () => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_APPLY_OMNI_UPDATE,
    });
  },

  updateDraftsScheduledAt: (scheduledAt, isPinnedToSlot) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UPDATE_DRAFTS_SCHEDULED_AT,
      scheduledAt,
      isPinnedToSlot,
    });
  },

};

export default ComposerActionCreators;
