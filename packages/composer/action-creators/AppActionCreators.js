import partition from 'lodash.partition';
import AppDispatcher from '../dispatcher';
import {
  ActionTypes, QueueingTypes, NotificationScopes, ErrorTypes, FloatingErrorCodes,
  InlineSaveButtonTypes, ButtonsQueuingTypesMap,
} from '../AppConstants';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import WebAPIUtils from '../utils/WebAPIUtils';
import ComposerStore from '../stores/ComposerStore';
import ComposerActionCreators from './ComposerActionCreators';
import AppStore from '../stores/AppStore';
import AppHooks from '../utils/lifecycle-hooks';
import Metrics from '../utils/Metrics';
import WebSocket from '../utils/WebSocket';
import ModalActionCreators from '../__legacy-buffer-web-shared-components__/modal/actionCreators';
import { extractSavedUpdatesIdsFromResponses } from '../utils/APIDataTransforms';

const getDefaultQueueingType = () => {
  const { saveButtons } = AppStore.getOptions();
  const [inlineSaveButtonTypes, stackedSaveButtonTypes] =
    partition(saveButtons, (button) => InlineSaveButtonTypes.includes(button));

  let saveButtonType;

  if (inlineSaveButtonTypes.length > 0) {
    saveButtonType = inlineSaveButtonTypes[inlineSaveButtonTypes.length - 1];
  } else if (stackedSaveButtonTypes.length > 0) {
    saveButtonType = stackedSaveButtonTypes[0];
  }

  return ButtonsQueuingTypesMap.get(saveButtonType);
};

const AppActionCreators = {

  // Preload a subset of relevant autocomplete data for Twitter
  refreshTwitterAutocompleteBootstrapData: (profilesIds) => {
    WebAPIUtils.getTwitterAutocompleteBootstrapData(profilesIds)
      .then((friends) => {
        AppDispatcher.handleApiAction({
          actionType: ActionTypes.APP_RECEIVE_TWITTER_AUTOCOMPLETE_BOOTSTRAP_DATA,
          friends,
          profilesIds,
        });
      });
  },

  saveDrafts: (
    queueingType = getDefaultQueueingType(),
    { customScheduleTime = null, shouldSkipEmptyTextAlert = true } = {}
  ) => {
    const { isSavingPossible } = AppStore.getAppState();
    const { shouldAlwaysSkipEmptyTextAlert } = AppStore.getUserData();
    const metaData = AppStore.getMetaData();
    const hadTextToPrefill = (
      metaData.text ||
      metaData.url ||
      metaData.via ||
      (metaData.retweetData && metaData.retweetData.comment)
    );

    if (!isSavingPossible) return;

    const { saveButtons } = AppStore.getOptions();
    const allowedQueuingTypes =
      saveButtons.map((saveButtonType) => ButtonsQueuingTypesMap.get(saveButtonType));
    if (!allowedQueuingTypes.includes(queueingType)) return;

    const shouldShowEmptyTextAlert = (
      !metaData.isPrefillingExistingUpdate &&
      hadTextToPrefill &&
      !shouldAlwaysSkipEmptyTextAlert &&
      !shouldSkipEmptyTextAlert &&
      AppStore.hasFBDraftWithNoText()
    );

    if (shouldShowEmptyTextAlert) {
      ModalActionCreators.openModal('EmptyTextAlert', { queueingType });
      return;
    }

    const data = {
      queueingType,
      customScheduleTime,
      profiles: AppStore.getSelectedProfiles(),
      drafts:
        ComposerStore.getEnabledDrafts().filter((draft) => !ComposerStore.isDraftLocked(draft.id)),
    };

    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_SAVE_DRAFTS,
      data,
    });

    WebAPIUtils.saveDrafts(data)
      .then(async ({ successfulResponses, unsuccessfulResponses }) => {
        // If we're "saving and approving", approve successfully saved updates
        if (queueingType === QueueingTypes.SAVE_AND_APPROVE && successfulResponses.length > 0) {
          const ids = extractSavedUpdatesIdsFromResponses(successfulResponses);
          await WebAPIUtils.approveDrafts(ids);
        }

        return { successfulResponses, unsuccessfulResponses };
      })
      .then(({ successfulResponses, unsuccessfulResponses }) => {
        AppDispatcher.handleApiAction({
          actionType: ActionTypes.COMPOSER_RECEIVE_SAVED_DRAFTS,
        });

        // Queue aggregate notification to let user know of general state of saved updates
        const areAllResponsesSuccessful = unsuccessfulResponses.length === 0;

        if (areAllResponsesSuccessful) {
          const successfulResponseMessageMap = new Map([
            [QueueingTypes.QUEUE, {
              singular: 'Great! The post has been added to your queue.',
              plural: 'Great! All posts have been added to your queue.',
            }],
            [QueueingTypes.NEXT, {
              singular: 'Great! The post has been added to your queue.',
              plural: 'Great! All posts have been added to your queue.',
            }],
            [QueueingTypes.NOW, {
              singular: 'Great! The post has been shared.',
              plural: 'Great! All posts have been shared.',
            }],
            [QueueingTypes.CUSTOM, {
              singular: 'Great! The post has been scheduled.',
              plural: 'Great! All posts have been scheduled.',
            }],
            [QueueingTypes.SAVE, {
              singular: 'Great! The post has been saved.',
              plural: 'Great! All posts have been saved.',
            }],
            [QueueingTypes.SAVE_AND_APPROVE, {
              singular: 'Great! The post has been saved.',
              plural: 'Great! All posts have been saved.',
            }],
            [QueueingTypes.ADD_DRAFT, {
              singular: 'Great! The post has been added to your drafts.',
              plural: 'Great! All posts have been added to your drafts.',
            }],
            [QueueingTypes.NEXT_DRAFT, {
              singular: 'Great! The post has been added to your drafts.',
              plural: 'Great! All posts have been added to your drafts.',
            }],
            [QueueingTypes.CUSTOM_DRAFT, {
              singular: 'Great! The post has been added to your drafts.',
              plural: 'Great! All posts have been added to your drafts.',
            }],
          ]);

          NotificationActionCreators.queueSuccess({
            scope: NotificationScopes.UPDATE_SAVING_AGGREGATE,
            message: (successfulResponses.length > 1) ?
              successfulResponseMessageMap.get(queueingType).plural :
              successfulResponseMessageMap.get(queueingType).singular,
          });
        }

        // Queue individual notifications to let user know of individual
        // error/success states for each composer (we could be even more granular
        // here by, for each composer, singling out profile ids that either succeeded
        // or failed, and offering custom messages accordingly)
        successfulResponses.forEach((successfulResponse) => {
          AppActionCreators.clearComposerInlineErrors(successfulResponse.serviceName);
          ComposerActionCreators.updateDraftHasSavingError(successfulResponse.serviceName, false);
          ComposerActionCreators.updateDraftIsSaved(successfulResponse.serviceName);
          NotificationActionCreators.queueSuccess({
            scope: `${NotificationScopes.UPDATE_SAVING}-${successfulResponse.serviceName}`,
          });
        });

        unsuccessfulResponses.forEach((unsuccessfulResponse) => {
          AppActionCreators.clearComposerInlineErrors(unsuccessfulResponse.serviceName);
          ComposerActionCreators.updateDraftHasSavingError(unsuccessfulResponse.serviceName, true);

          const scope = FloatingErrorCodes.includes(unsuccessfulResponse.code) ?
            `${NotificationScopes.UPDATE_SAVING}-${ErrorTypes.FLOATING}` :
            `${NotificationScopes.UPDATE_SAVING}-${ErrorTypes.INLINE}-${unsuccessfulResponse.serviceName}`;

          NotificationActionCreators.queueError({
            scope,
            message: unsuccessfulResponse.message,
          });
        });

        // Run this at the very end so that we can assume other actions have already propagated
        if (areAllResponsesSuccessful) AppHooks.handleSavedDrafts();
      });
  },

  clearComposerInlineErrors: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_CLEAR_INLINE_ERRORS,
      id,
    });
  },

  createNewSubprofile: (profileId, name) => {
    const data = { name };

    WebAPIUtils.createNewSubprofile(profileId, data)
      .then((newSubprofile) => {
        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE,
          profileId: newSubprofile.profileId,
          subprofileId: newSubprofile.id,
          avatar: newSubprofile.avatar,
          name: newSubprofile.name,
          isShared: newSubprofile.isShared,
        });
      })
      .catch(({ message }) => {
        AppDispatcher.handleViewAction({
          actionType: ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE_FAILED,
          profileId,
        });

        NotificationActionCreators.queueError({
          scope: NotificationScopes.BOARD_CREATION,
          data: { profileId },
          message,
        });
      });
  },

  refreshSubprofileData: (profileId) => {
    WebAPIUtils.fetchProfileSubprofiles(profileId)
    .then((response) => {
      AppDispatcher.handleViewAction({
        actionType: ActionTypes.APP_REFRESH_SUBPROFILE_DATA,
        profileId,
        subprofileData: response.subprofiles,
      });
    });
  },

  createSubprofilePending: (profileId) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE_PENDING,
      profileId,
    });
  },

  unselectSubprofile: (profileId, subprofileId) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_UNSELECT_SUBPROFILE,
      profileId,
      subprofileId,
    });
  },

  selectSubprofile: (profileId, subprofileId) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_SELECT_SUBPROFILE,
      profileId,
      subprofileId,
    });
  },

  selectProfile: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_SELECT_PROFILE,
      id,
    });
  },

  unselectProfile: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UNSELECT_PROFILE,
      id,
    });
  },

  selectProfiles: (ids, markAppAsLoadedWhenDone = false) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_SELECT_PROFILES,
      ids,
      markAppAsLoadedWhenDone,
    });
  },

  unselectProfiles: (ids) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_UNSELECT_PROFILES,
      ids,
    });
  },

  queueProfileSubprofilesDropdownsIdsToExpand: (ids) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_QUEUE_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND,
      ids,
    });
  },

  emptyProfileSubprofilesDropdownsIdsToExpand: () => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_EMPTY_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND,
    });
  },

  selectProfilesOnBehalfOfUser: (ids) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_SELECT_PROFILES_ON_BEHALF_OF_USER,
      ids,
    });
  },

  collapseProfileSubprofileDropdown: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_COLLAPSE_PROFILE_SUBPROFILE_DROPDOWN,
      id,
    });
  },

  expandProfileSubprofileDropdown: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.COMPOSER_EXPAND_PROFILE_SUBPROFILE_DROPDOWN,
      id,
    });
  },

  profileDropdownHidden: () => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.PROFILE_DROPDOWN_HIDDEN,
    });
  },

  selectGroupProfiles: (id) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_SELECT_GROUP_PROFILES,
      id,
    });
  },

  unselectGroupProfiles: (id, selectedProfileGroupsIds) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_UNSELECT_GROUP_PROFILES,
      id,
      selectedProfileGroupsIds,
    });
  },

  getProfileSlotDataForMonth: (() => {
    const pendingAPICalls = new Set();

    return (profileId, momentInMonth) => {
      const startDateString = momentInMonth.startOf('month').format('YYYY-MM-DD');
      const endDateString = momentInMonth.endOf('month').format('YYYY-MM-DD');
      const requestIdentifier = `${profileId}-${startDateString}-${endDateString}`;

      // If a request for the same profile and month is already running, don't make another one
      if (pendingAPICalls.has(requestIdentifier)) return;

      WebAPIUtils.getProfileSlotDataForDateRange(profileId, startDateString, endDateString)
        .then((slots) => {
          pendingAPICalls.delete(requestIdentifier);

          AppDispatcher.handleViewAction({
            actionType: ActionTypes.APP_RECEIVE_PROFILE_SLOT_DATA,
            id: profileId,
            slots,
          });
        });

      pendingAPICalls.add(requestIdentifier);
    };
  })(),

  closeComposer: () => AppHooks.closeComposer(),

  trackUserAction: (scope, extraData) => {
    // Auto-insert 'multiple-composers' as second scope for all tracking
    scope.splice(1, 0, 'multiple-composers');

    Metrics.trackAction(scope, extraData);
  },

  toggleAllProfiles: () => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_TOGGLE_ALL_PROFILES,
    });
  },

  updateOmniboxState: (isEnabled) => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_UPDATE_OMNIBOX_STATE,
      isEnabled,
    });
  },

  rememberModalView: (modalKey) => WebAPIUtils.rememberModalView(modalKey),

  markAppAsLoaded: () => {
    AppDispatcher.handleViewAction({
      actionType: ActionTypes.APP_LOADED,
    });
  },

  listenToChangeEventsForGroups: () => {
    WebSocket.init();
  },
};

export default AppActionCreators;
