import { EventEmitter } from 'events';
import partition from 'lodash.partition';
import debounce from 'lodash.debounce';
import escapeRegExp from 'lodash.escaperegexp';
import moment from 'moment-timezone';
import AppDispatcher from '../dispatcher';
import { ActionTypes, AsyncOperationStates, Services, QueueingTypes } from '../AppConstants';
import ComposerStore from './ComposerStore';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import AppActionCreators from '../action-creators/AppActionCreators';

const CHANGE_EVENT = 'change';

const getInitialState = () => ({
  profiles: [], // Data structure in getNewProfile()

  // Describe the application state
  appState: {
    isLoaded: false,
    expandedComposerId: null,
    expandedProfileSubprofileDropdownId: null,
    isDraftsSavePending: false,
    draftSaveQueueingType: null,
    isSavingPossible: false,
    whatPreventsSaving: [], // Data structure in getNewPreventsSavingObj()
    composersWhichHaveBeenCollapsed: new Set(),
    composersHaveBeenExpanded: false,
    twitterAutocompleBootstrapData: null, // Data struct in getNewTwitterAutocompleteBootstrapData()

    // Ids of profiles whose subprofile dropdowns we want to auto-expand
    profileSubprofileDropdownsIdsToExpand: [],
    isOmniboxEnabled: null, // true if enabled, false if enabled then disabled, null if untouched
  },

  userData: {}, // Data structure in getNewUserData()
  metaData: {},
  options: {},
  csrfToken: null,
  imageDimensionsKey: null,
});

let state = getInitialState();


const getNewProfile = (data) => ({
  id: data.id,
  service: {
    name: data.serviceName,
    username: data.serviceUsername,
    formattedUsername: data.serviceFormattedUsername,
  },
  images: {
    avatar: data.imagesAvatar,
  },
  timezone: data.timezone,
  shouldBeAutoSelected: data.shouldBeAutoSelected,
  isSelected: false,
  isDisabled: data.isDisabled,
  subprofiles: data.subprofiles, // Data structure in getNewSubprofile()
  selectedSubprofileId: null,
  serviceType: data.serviceType,
  isBusinessProfile: data.isBusinessProfile,
  subprofilesOrignatedFromAPI: null,

  // Profile-specific app state
  appState: {
    isSubprofileCreationPending: false,
  },
});

const getNewProfileGroup = ({ id, name, profileIds }) =>
  ({ id, name, profileIds });

const getNewUserData = (data) => ({
  id: data.id,
  s3UploadSignature: data.s3UploadSignature,
  uses24hTime: data.uses24hTime,
  profileGroups: data.profileGroups.map(getNewProfileGroup),
  isFreeUser: data.isFreeUser,
  isBusinessUser: data.isBusinessUser,
  weekStartsMonday: data.weekStartsMonday,
  shouldAlwaysSkipEmptyTextAlert: data.shouldAlwaysSkipEmptyTextAlert,
  profilesSchedulesSlots: data.profilesSchedulesSlots,
  onNewPublish: data.onNewPublish,
});

const getNewSubprofile = ({ avatar, id, name, isShared }) =>
  ({ avatar, id, name, isShared });

const getNewPreventsSavingObj = ({ message, composerId = null, code = undefined }) =>
  ({ message, composerId, code });

const getNewTwitterAutocompleteBootstrapData = ({ friends, profilesIds }) =>
  ({ friends, profilesIds });

const AppStore = Object.assign({}, EventEmitter.prototype, {
  emitChange: () => AppStore.emit(CHANGE_EVENT),
  addChangeListener: (callback) => AppStore.on(CHANGE_EVENT, callback),
  removeChangeListener: (callback) => AppStore.removeListener(CHANGE_EVENT, callback),

  getAppState: () => state.appState,
  getUserData: () => state.userData,
  getMetaData: () => state.metaData,
  getOptions: () => state.options,
  getCsrfToken: () => state.csrfToken,
  getImageDimensionsKey: () => state.imageDimensionsKey,

  // Get all profiles if no param passed, or profiles matching a passed array of ids
  getProfiles: (ids = null) => {
    let profiles;

    if (ids === null) {
      profiles = state.profiles;
    } else {
      profiles = state.profiles
        .filter((profile) => ids.includes(profile.id))
        .sort((profileA, profileB) => (ids.indexOf(profileA.id) < ids.indexOf(profileB.id) ? -1 : 1));
    }

    return profiles;
  },

  getProfileIds: () => AppStore.getProfiles().map((profile) => profile.id),

  getProfilesForService: (serviceName) =>
    AppStore.getProfiles().filter((profile) => profile.service.name === serviceName),

  getSelectedProfiles: () => state.profiles.filter((profile) => profile.isSelected),

  hasProfilesSelected: () => state.profiles.some((profile) => profile.isSelected),

  hasFBDraftWithNoText: () => {
    const emptyFacebookDrafts =
      ComposerStore.getEnabledDrafts().filter((draft) =>
        draft.id === 'facebook' &&
        draft.editorState.getCurrentContent().getPlainText().length < 1
      );
    return emptyFacebookDrafts.length > 0;
  },

  getSelectedProfilesForService: (serviceName) =>
    AppStore.getSelectedProfiles().filter((profile) => profile.service.name === serviceName),

  getProfile: (id) => state.profiles.find((profile) => profile.id === id),

  getProfileGroup: (id) => state.userData.profileGroups.find((group) => group.id === id),

  getServicesWithSelectedProfiles: () => {
    const selectedProfilesServicesNames =
      AppStore.getSelectedProfiles().map((profile) => profile.service.name);

    const dedupedServicesNames = [...new Set(selectedProfilesServicesNames)];
    const selectedServices = dedupedServicesNames.map((serviceName) => Services.get(serviceName));

    return selectedServices;
  },

  isTwitterAutocompleBootstrapDataLoaded: () => (
    state.appState.twitterAutocompleBootstrapData !== null
  ),

  getMatchingTwitterAutocompleteBootstrapData: (search) => {
    const regExpCompatSearch = escapeRegExp(search);
    const searchRegex = new RegExp(regExpCompatSearch, 'i');

    return state.appState.twitterAutocompleBootstrapData.friends
      .filter((user) => user.screenName.startsWith(search) || searchRegex.test(user.fullName));
  },

  getTwitterAutocompleteBootstrapDataProfilesIds: () => (
    state.appState.twitterAutocompleBootstrapData !== null ?
      state.appState.twitterAutocompleBootstrapData.profilesIds : []
  ),

  /**
   * Returns:
   * - false if slot picking isn't available
   * - undefined if slots data for that day isn't available (yet)
   * - an array of slots for that day (empty if no slots)
   */
  getAvailableSchedulesSlotsForDay: (timestamp) => {
    const selectedProfiles = AppStore.getSelectedProfiles();
    const isSlotPickingAvailable = selectedProfiles.length === 1;
    if (!isSlotPickingAvailable) return false;

    const { id: profileId } = selectedProfiles[0];
    // eslint-disable-next-line no-use-before-define
    const localDateMoment = getProfileLocalTimeMoment(profileId, timestamp);

    // eslint-disable-next-line no-use-before-define
    return getProfileSlotsForDay(profileId, localDateMoment);
  },
});

const createProfiles = (profilesData) =>
  profilesData.forEach((profileData) => state.profiles.push(getNewProfile(profileData)));

const createProfileGroup = (groupData) =>
  state.userData.profileGroups.push(getNewProfileGroup(groupData));

const updateProfileGroup = ({ id, name, profileIds }) => {
  const groupToUpdate = state.userData.profileGroups.find((group) => group.id === id);

  Object.assign(groupToUpdate, {
    name,
    profileIds,
  });
};

const deleteProfileGroup = ({ id }) => {
  const index = state.userData.profileGroups.findIndex((group) => group.id === id);
  state.userData.profileGroups.splice(index, 1);
};

const setDraftsSavingState = (savingState, queueingType = QueueingTypes.QUEUE) => {
  switch (savingState) {
    case AsyncOperationStates.PENDING:
      state.appState.isDraftsSavePending = true;
      state.appState.draftSaveQueueingType = queueingType;
      break;

    case AsyncOperationStates.DONE:
      state.appState.isDraftsSavePending = false;
      break;

    default:
      break;
  }
};

// Auto-expand composer when only 1 profile is selected
const maybeAutoExpandComposer = () => {
  const activeServices = AppStore.getServicesWithSelectedProfiles();
  const hasOneActiveService = activeServices.length === 1;
  if (!hasOneActiveService || state.appState.isOmniboxEnabled) return;

  const activeService = activeServices[0];
  const composerId = activeService.name;
  ComposerActionCreators.expand(composerId);
};

// Make sure we always have fresh autocomplete bootstrap data for Twitter
const refreshTwitterAutocompleteBootstrapData = debounce(() => {
  if (!state.metaData.shouldUseNewTwitterAutocomplete) return;

  const selectedProfiles = AppStore.getSelectedProfilesForService('twitter');
  const firstTwo = selectedProfiles.slice(0, 2);
  if (firstTwo.length === 0) return;

  const firstTwoIds = firstTwo.map((profile) => profile.id);
  const currentBootstrapDataProfilesIds = AppStore.getTwitterAutocompleteBootstrapDataProfilesIds();

  const shouldRefreshBootstrapData = (
    currentBootstrapDataProfilesIds.length > firstTwoIds.length ||
    firstTwoIds.some((id) => !currentBootstrapDataProfilesIds.includes(id))
  );

  if (shouldRefreshBootstrapData) {
    AppActionCreators.refreshTwitterAutocompleteBootstrapData(firstTwoIds);
  }
}, 1000);

/**
 * Select profiles in place of user, by either opening dropdown for subprofile-enabled
 * networks, or actually selecting the profile straight away for other networks.
 */
const selectProfilesOnBehalfOfUser = (ids, markAppAsLoadedWhenDone = false) => {
  const profilesToSelect = AppStore.getProfiles(ids);

  const [profilesWithSubprofiles, profilesWithoutSubprofiles] =
    partition(profilesToSelect, (profile) => profile.subprofiles.length > 0);

  const hasProfilesWithoutSubprofiles = profilesWithoutSubprofiles.length > 0;
  const hasProfilesWithSubprofiles = profilesWithSubprofiles.length > 0;

  if (hasProfilesWithoutSubprofiles) {
    const profilesIdsWithoutSubprofiles = profilesWithoutSubprofiles.map((profile) => profile.id);
    AppActionCreators.selectProfiles(profilesIdsWithoutSubprofiles, markAppAsLoadedWhenDone);
  } else if (markAppAsLoadedWhenDone) {
    AppActionCreators.markAppAsLoaded();
  }

  if (hasProfilesWithSubprofiles) {
    const profilesIdsWithSubprofiles = profilesWithSubprofiles.map((profile) => profile.id);
    AppActionCreators.queueProfileSubprofilesDropdownsIdsToExpand(profilesIdsWithSubprofiles);
  }
};

const selectProfile = (id, markAppAsLoadedWhenDone = false) => {
  const profile = AppStore.getProfile(id);
  if (profile.isSelected) return;
  if (profile.isDisabled) return;

  // Select profile
  profile.isSelected = true;

  // Enable composer if the selected profile is the first selected for that service
  const serviceName = profile.service.name;
  const selectedProfilesCountForService =
    AppStore.getSelectedProfilesForService(serviceName).length;

  if (selectedProfilesCountForService === 1) {
    const composerId = serviceName;
    ComposerActionCreators.enable(composerId, markAppAsLoadedWhenDone);
    ComposerActionCreators.parseDraftTextLinks(composerId);
  } else if (markAppAsLoadedWhenDone) {
    AppActionCreators.markAppAsLoaded();
  }

  if (serviceName === 'twitter') refreshTwitterAutocompleteBootstrapData();
};

const unselectProfile = (id) => {
  const profile = AppStore.getProfile(id);
  if (!profile.isSelected) return;

  // Unselect profile
  profile.isSelected = false;

  // Unselect subprofile if any (profiles can be unselected via unselectSubprofile() or directly)
  profile.selectedSubprofileId = null;

  // Disable composer if the unselected profile was the last selected for that service
  const serviceName = profile.service.name;
  const selectedProfilesCountForService =
    AppStore.getSelectedProfilesForService(serviceName).length;

  if (selectedProfilesCountForService === 0) {
    const composerId = serviceName;
    ComposerActionCreators.disable(composerId);
  }

  maybeAutoExpandComposer();

  if (serviceName === 'twitter') refreshTwitterAutocompleteBootstrapData();
};

const selectSubprofile = (profileId, subprofileId) => {
  const profile = AppStore.getProfile(profileId);
  profile.selectedSubprofileId = subprofileId;

  AppActionCreators.selectProfile(profile.id);
};

const selectSubprofiles = (idsMap, markAppAsLoadedWhenDone = false) => {
  const profileIds = [];

  idsMap.forEach((subprofileId, profileId) => {
    const profile = AppStore.getProfile(profileId);
    profile.selectedSubprofileId = subprofileId;

    profileIds.push(profileId);
  });

  AppActionCreators.selectProfiles(profileIds, markAppAsLoadedWhenDone);
};

const unselectSubprofile = (profileId) => {
  const profile = AppStore.getProfile(profileId);
  profile.selectedSubprofileId = null;

  AppActionCreators.unselectProfile(profile.id);
};

// List of conditions to pass in order to be able to save the updates
// For perf reasons all the checks aren't run all the time, we try to fail as early
// as possible, though in some sitations it's useful to have multiple checks run
// to provide more complete feedback.
const checkIfSavingPossible = () => {
  // At least one profile should be selected
  if (!AppStore.hasProfilesSelected()) {
    return {
      isSavingPossible: false,
      whatPreventsSaving: [{
        message: 'At least one profile should be selected',
      }],
    };
  }

  // Updates shouldn't be in the process of being saved
  if (state.appState.isDraftsSavePending) {
    return {
      isSavingPossible: false,
    };
  }

  // Updates shouldn't have been saved already, or contain only non-fixable errors
  if (ComposerStore.areDraftsSavedOrUnfixable()) {
    return {
      isSavingPossible: false,
      whatPreventsSaving: [{
        message: 'No more updates to be saved',
      }],
    };
  }

  // Enabled drafts shouldn't be empty
  const invalidEnabledDraftsInfo = ComposerStore.getInvalidEnabledDraftsFeedback();
  const hasInvalidEnabledDrafts = invalidEnabledDraftsInfo.length > 0;

  // Enabled drafts shouldn't be above the optional character limit
  const enabledDrafts = ComposerStore.getEnabledDrafts();
  const enabledDraftsAboveCharLimit = enabledDrafts.filter((draft) =>
    draft.characterCount > draft.service.charLimit);
  const hasEnabledDraftsAboveCharLimit = enabledDraftsAboveCharLimit.length > 0;

  if (hasInvalidEnabledDrafts || hasEnabledDraftsAboveCharLimit) {
    return {
      isSavingPossible: false,
      whatPreventsSaving: Array.prototype.concat.call(
        enabledDraftsAboveCharLimit.map((draft) => ({
          message: `We can only fit ${draft.service.charLimit} characters in this post`,
          composerId: draft.id,
          code: 1,
        })),
        ...invalidEnabledDraftsInfo.map(({ draft, messages }) => (
          messages.map((message) => ({
            message,
            composerId: draft.id,
          }))
        ))
      ),
    };
  }

  // Enabled drafts, if scheduled, should be scheduled for a time in the future
  const scheduledAt = ComposerStore.getScheduledAt();
  const currentTimestampSeconds = Math.floor(Date.now() / 1000);
  if (scheduledAt !== null && scheduledAt <= currentTimestampSeconds) {
    return {
      isSavingPossible: false,
      whatPreventsSaving: [{
        message: 'The scheduled time seems to be in the past',
      }],
    };
  }

  return { isSavingPossible: true };
};

const updateIsSavingPossible = () => {
  const { isSavingPossible, whatPreventsSaving = [] } = checkIfSavingPossible();

  state.appState.isSavingPossible = isSavingPossible;
  state.appState.whatPreventsSaving =
    whatPreventsSaving.map((what) => getNewPreventsSavingObj(what));
};

const getExpandedComposerId = () => state.appState.expandedComposerId;

const setExpandedComposerId = (id) => {
  if (id !== null && typeof id !== 'undefined') {
    if (ComposerStore.isDraftLocked(id)) return;
  }
  state.appState.expandedComposerId = id;
};

const setComposersHaveBeenExpanded = () => (state.appState.composersHaveBeenExpanded = true);

const expandProfileSubprofileDropdown = (id) => {
  state.appState.expandedProfileSubprofileDropdownId = id;

  const idIndex = state.appState.profileSubprofileDropdownsIdsToExpand.indexOf(id);
  const wasDropdownWaitingForExpansion = idIndex !== -1;

  if (wasDropdownWaitingForExpansion) {
    state.appState.profileSubprofileDropdownsIdsToExpand.splice(idIndex, 1);
  }
};

const collapseProfileSubprofileDropdown = (id) => {
  const isDropdownCurrentlyExpanded = state.appState.expandedProfileSubprofileDropdownId === id;
  if (!isDropdownCurrentlyExpanded) return;

  const dropdownIdsToExpand = state.appState.profileSubprofileDropdownsIdsToExpand;
  const shouldExpandOtherDropdowns = dropdownIdsToExpand.length > 0;

  if (shouldExpandOtherDropdowns) {
    const nextDropdownId = dropdownIdsToExpand[0];
    expandProfileSubprofileDropdown(nextDropdownId);
  } else {
    state.appState.expandedProfileSubprofileDropdownId = null;
  }
};

const queueProfileSubprofilesDropdownsIdsToExpand = (ids) => {
  const unselectedProfileIds = ids.filter((id) => {
    const profile = AppStore.getProfile(id);
    return !profile.isSelected && !profile.isDisabled;
  });
  if (unselectedProfileIds.length === 0) return;

  state.appState.profileSubprofileDropdownsIdsToExpand.push(...unselectedProfileIds);

  // Automatically expand first queued profile's subprofiles dropdown
  const firstUnselectedProfileId = unselectedProfileIds[0];
  expandProfileSubprofileDropdown(firstUnselectedProfileId);
};

const emptyProfileSubprofilesDropdownsIdsToExpand = () => {
  state.appState.profileSubprofileDropdownsIdsToExpand = [];
};

const setUserData = (userData) => (state.userData = getNewUserData(userData));
const setImageDimensionsKey = (key) => (state.imageDimensionsKey = key);
const setMetaData = (metaData) => (state.metaData = metaData);
const setOptions = (options) => (state.options = options);
const setCsrfToken = (csrfToken) => (state.csrfToken = csrfToken);

const setTwitterAutocompleteBootstrapData = (friends, profilesIds) => {
  state.appState.twitterAutocompleBootstrapData =
    getNewTwitterAutocompleteBootstrapData({ friends, profilesIds });
};

const createNewSubprofile = (profileId, id, avatar, name, isShared) => {
  const profile = AppStore.getProfile(profileId);
  profile.subprofilesOrignatedFromAPI = false;
  const subprofile = getNewSubprofile({ avatar, id, name, isShared });
  profile.subprofiles.push(subprofile);
};

const refreshSubprofileData = (subprofiles, profileId) => {
  const profile = AppStore.getProfile(profileId);
  if (profile.subprofiles.length < subprofiles.length) {
    profile.subprofilesOrignatedFromAPI = true;
  }
  profile.subprofiles = subprofiles.map((subprofile) => getNewSubprofile(subprofile));
};

const setProfileSubprofileCreationState = (profileId, creationState) => {
  const profile = AppStore.getProfile(profileId);

  switch (creationState) {
    case AsyncOperationStates.PENDING:
      profile.appState.isSubprofileCreationPending = true;
      break;

    case AsyncOperationStates.DONE:
      profile.appState.isSubprofileCreationPending = false;
      break;

    default:
      break;
  }
};

const selectGroupProfiles = (id) => {
  const { profileIds: profilesIdsToSelect } = AppStore.getProfileGroup(id);
  AppActionCreators.selectProfilesOnBehalfOfUser(profilesIdsToSelect);
};

const unselectGroupProfiles = (id, selectedProfileGroupsIds) => {
  const group = AppStore.getProfileGroup(id);
  // Remove the unselected group's id from the list of selected groups' ids
  const unselectedGroupIndex = selectedProfileGroupsIds.indexOf(id);
  selectedProfileGroupsIds.splice(unselectedGroupIndex, 1);

  // Get all the profile ids from unique groups
  const selectedProfileIdsFromUniqueGroups =
    selectedProfileGroupsIds.reduce((reducedUniqueGroupsProfileIds, selectedGroupId) => {
      const selectedGroup = AppStore.getProfileGroup(selectedGroupId);
      reducedUniqueGroupsProfileIds =
        selectedGroup.profileIds.length === group.profileIds.length &&
        selectedGroup.profileIds.every((item) => group.profileIds.includes(item)) ?
        reducedUniqueGroupsProfileIds :
        reducedUniqueGroupsProfileIds.concat(selectedGroup.profileIds);
      return reducedUniqueGroupsProfileIds;
    }, []);

  // Unselect this group's profiles that aren't selected as part of another group,
  const profilesIdsToUnselect =
    group.profileIds.reduce((reducedProfilesIdsToUnselect, profileIdToUnselect) =>
      (selectedProfileIdsFromUniqueGroups.includes(profileIdToUnselect) ?
      reducedProfilesIdsToUnselect : reducedProfilesIdsToUnselect.concat(profileIdToUnselect)),
    []);
  AppActionCreators.unselectProfiles(profilesIdsToUnselect);
};

const toggleAllProfiles = () => {
  const profiles = AppStore.getProfiles();

  const [selectedProfiles, unselectedProfiles] =
    partition(profiles, (profile) => profile.isSelected);

  const hasSelectedProfiles = selectedProfiles.length > 0;

  if (hasSelectedProfiles) {
    const selectedProfilesIds = selectedProfiles.map((profile) => profile.id);
    AppActionCreators.unselectProfiles(selectedProfilesIds);
    AppActionCreators.emptyProfileSubprofilesDropdownsIdsToExpand();
  } else {
    // Preserve last active composer's contents, if it's not empty, by making its profiles
    // the first profiles to be selected (and thus its composer the first to be enabled)
    const { lastInteractedWithComposerId } = ComposerStore.getMeta();
    const unselectedProfilesIds = unselectedProfiles
      .sort((profile) => (profile.service.name === lastInteractedWithComposerId ? -1 : 1))
      .map((profile) => profile.id);
    AppActionCreators.selectProfilesOnBehalfOfUser(unselectedProfilesIds);
  }
};

const markPreviouslyExpandedComposerAsCollapsed = () => {
  const expandedComposerId = state.appState.expandedComposerId;
  const wasOneComposerPreviouslyExpanded = expandedComposerId !== null;

  if (wasOneComposerPreviouslyExpanded && !state.appState.isOmniboxEnabled) {
    state.appState.composersWhichHaveBeenCollapsed.add(expandedComposerId);
  }
};

const collapseComposer = () => {
  if (AppStore.getServicesWithSelectedProfiles().length === 1) return;

  markPreviouslyExpandedComposerAsCollapsed();
  setExpandedComposerId(null);

  AppActionCreators.trackUserAction(['composer', 'collapse']);
};

const markAppAsLoaded = () => {
  state.appState.isLoaded = true;
};

const updateOmniboxState = (isEnabled) => {
  state.appState.isOmniboxEnabled = isEnabled;
};

const getProfileLocalTimeMoment = (profileId, timestamp) => {
  const profile = AppStore.getProfile(profileId);

  let localMoment = moment.unix(timestamp);
  if (profile.timezone) localMoment = localMoment.tz(profile.timezone);

  return localMoment;
};

const getProfileSlotsForDay = (profileId, localDateMoment) => {
  const { userData } = state;

  if (!userData.profileSchedulesSlots) return undefined;

  const profileSchedulesSlots = userData.profilesSchedulesSlots[profileId];
  const dateString = localDateMoment.format('YYYY-MM-DD');

  return profileSchedulesSlots[dateString];
};

/**
 * The initial data that bookmarklet.php boostraps the app with only has slot
 * data available for a limited number of days. Whenever we might need more
 * slot data (scheduledAt or profile changed), make sure we have it!
 */
const ensureProfileSchedulesSlotsDataIsAvailableForDate = (timestamp = null) => {
  const selectedProfiles = AppStore.getSelectedProfiles();
  let isSlotPickingAvailable = selectedProfiles.length === 1;
  if (!isSlotPickingAvailable) return;

  if (timestamp === null) {
    timestamp = ComposerStore.getScheduledAt();
    isSlotPickingAvailable = timestamp !== null;

    if (!isSlotPickingAvailable) return;
  }

  const { id: profileId } = selectedProfiles[0];
  const localDateMoment = getProfileLocalTimeMoment(profileId, timestamp);

  const firstDayOfMonthMoment = localDateMoment.clone().startOf('month');
  const lastDayOfMonthMoment = localDateMoment.clone().endOf('month');
  const profileSlotsForFirstDayOfMonth = getProfileSlotsForDay(profileId, firstDayOfMonthMoment);
  const profileSlotsForLastDayOfMonth = getProfileSlotsForDay(profileId, lastDayOfMonthMoment);

  const isSlotDataForMonthMissing =
    typeof profileSlotsForFirstDayOfMonth === 'undefined' ||
    typeof profileSlotsForLastDayOfMonth === 'undefined';

  // Fetch more data from API if we're missing data for this month
  if (isSlotDataForMonthMissing) {
    AppActionCreators.getProfileSlotDataForMonth(profileId, localDateMoment);
  }
};

const updateProfileSchedulesSlots = (id, slots = {}) => {
  const { profilesSchedulesSlots } = state.userData;

  if (!profilesSchedulesSlots.hasOwnProperty(id)) profilesSchedulesSlots[id] = {};
  const profileSchedulesSlots = profilesSchedulesSlots[id];

  const addDaySlotsToProfileSchedulesSlots = (dayString) =>
    (profileSchedulesSlots[dayString] = slots[dayString]);

  Object.keys(slots).forEach(addDaySlotsToProfileSchedulesSlots);
};

const onDispatchedPayload = (payload) => {
  const action = payload.action;
  let isPayloadInteresting = true;

  switch (action.actionType) {
    case ActionTypes.COMPOSER_CREATE_PROFILES:
      createProfiles(action.profilesData);
      break;

    case ActionTypes.COMPOSER_SAVE_DRAFTS:
      setDraftsSavingState(AsyncOperationStates.PENDING, action.data.queueingType);
      break;

    case ActionTypes.APP_SELECT_SUBPROFILE:
      selectSubprofile(action.profileId, action.subprofileId);
      collapseProfileSubprofileDropdown(action.profileId);
      break;

    case ActionTypes.APP_SELECT_SUBPROFILES:
      selectSubprofiles(action.idsMap, action.markAppAsLoadedWhenDone);
      action.idsMap.forEach((subprofileId, profileId) => {
        collapseProfileSubprofileDropdown(profileId);
      });
      break;

    case ActionTypes.APP_UNSELECT_SUBPROFILE:
      unselectSubprofile(action.profileId, action.subprofileId);
      collapseProfileSubprofileDropdown(action.profileId);
      break;

    case ActionTypes.APP_UPDATE_OMNIBOX_STATE:
      updateOmniboxState(action.isEnabled);
      break;

    case ActionTypes.COMPOSER_RECEIVE_SAVED_DRAFTS:
      setDraftsSavingState(AsyncOperationStates.DONE);
      break;

    case ActionTypes.COMPOSER_SELECT_PROFILES_ON_BEHALF_OF_USER:
      selectProfilesOnBehalfOfUser(action.ids, action.markAppAsLoadedWhenDone);
      break;

    case ActionTypes.COMPOSER_SELECT_PROFILE:
      selectProfile(action.id);
      maybeAutoExpandComposer();
      ensureProfileSchedulesSlotsDataIsAvailableForDate();
      break;

    case ActionTypes.COMPOSER_SELECT_PROFILES:
      action.ids.forEach((id, i) => {
        const markAppAsLoadedWhenDone = action.markAppAsLoadedWhenDone && i === 0;
        selectProfile(id, markAppAsLoadedWhenDone);
      });
      maybeAutoExpandComposer();
      ensureProfileSchedulesSlotsDataIsAvailableForDate();
      break;

    case ActionTypes.COMPOSER_UNSELECT_PROFILE:
      unselectProfile(action.id);
      ensureProfileSchedulesSlotsDataIsAvailableForDate();
      break;

    case ActionTypes.COMPOSER_UNSELECT_PROFILES:
      action.ids.forEach(unselectProfile);
      ensureProfileSchedulesSlotsDataIsAvailableForDate();
      break;

    case ActionTypes.COMPOSER_QUEUE_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND:
      queueProfileSubprofilesDropdownsIdsToExpand(action.ids);
      break;

    case ActionTypes.COMPOSER_EMPTY_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND:
      emptyProfileSubprofilesDropdownsIdsToExpand();
      break;

    case ActionTypes.COMPOSER_EXPAND:
      markPreviouslyExpandedComposerAsCollapsed();
      setExpandedComposerId(action.id);
      setComposersHaveBeenExpanded();
      break;

    // We consider a composer's contents saved when it's collapsed
    case ActionTypes.COMPOSER_COLLAPSE:
      collapseComposer();
      break;

    // Ensure a disabled composer doesn't remain expanded
    case ActionTypes.COMPOSER_DISABLE:
      if (getExpandedComposerId() === action.id) setExpandedComposerId(null);
      break;

    case ActionTypes.APP_RECEIVE_USER_DATA:
      setUserData(action.userData);
      break;
    case ActionTypes.APP_RECEIVE_IMAGE_DIMENSIONS_KEY:
      setImageDimensionsKey(action.imageDimensionsKey);
      break;

    case ActionTypes.APP_RECEIVE_METADATA:
      setMetaData(action.metaData);
      break;

    case ActionTypes.APP_RECEIVE_OPTIONS:
      setOptions(action.options);
      break;

    case ActionTypes.APP_RECEIVE_CSRF_TOKEN:
      setCsrfToken(action.csrfToken);
      break;

    case ActionTypes.APP_RECEIVE_TWITTER_AUTOCOMPLETE_BOOTSTRAP_DATA:
      setTwitterAutocompleteBootstrapData(action.friends, action.profilesIds);
      break;

    case ActionTypes.COMPOSER_EXPAND_PROFILE_SUBPROFILE_DROPDOWN:
      expandProfileSubprofileDropdown(action.id);
      break;

    case ActionTypes.COMPOSER_COLLAPSE_PROFILE_SUBPROFILE_DROPDOWN:
      collapseProfileSubprofileDropdown(action.id);
      break;

    case ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE:
      createNewSubprofile(
        action.profileId,
        action.subprofileId,
        action.avatar,
        action.name,
        action.isShared
      );
      setProfileSubprofileCreationState(action.profileId, AsyncOperationStates.DONE);
      break;

    case ActionTypes.APP_REFRESH_SUBPROFILE_DATA:
      refreshSubprofileData(action.subprofileData, action.profileId);
      break;

    case ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE_FAILED:
      setProfileSubprofileCreationState(action.profileId, AsyncOperationStates.DONE);
      break;

    case ActionTypes.COMPOSER_CREATE_NEW_SUBPROFILE_PENDING:
      setProfileSubprofileCreationState(action.profileId, AsyncOperationStates.PENDING);
      break;

    case ActionTypes.APP_SELECT_GROUP_PROFILES:
      selectGroupProfiles(action.id);
      break;

    case ActionTypes.APP_UNSELECT_GROUP_PROFILES:
      unselectGroupProfiles(action.id, action.selectedProfileGroupsIds);
      break;

    case ActionTypes.APP_TOGGLE_ALL_PROFILES:
      toggleAllProfiles();
      break;

    case ActionTypes.COMPOSER_PROFILE_GROUP_CREATED:
      createProfileGroup(action.groupData);
      break;

    case ActionTypes.COMPOSER_PROFILE_GROUP_UPDATED:
      updateProfileGroup(action.groupData);
      break;

    case ActionTypes.COMPOSER_PROFILE_GROUP_DELETED:
      deleteProfileGroup(action.groupData);
      break;

    case ActionTypes.APP_LOADED:
      markAppAsLoaded();
      break;

    case ActionTypes.APP_RESET:
      state = getInitialState();
      break;

    case ActionTypes.COMPOSER_UPDATE_DRAFTS_SCHEDULED_AT:
      ensureProfileSchedulesSlotsDataIsAvailableForDate(action.scheduledAt);
      break;

    case ActionTypes.APP_RECEIVE_PROFILE_SLOT_DATA:
      updateProfileSchedulesSlots(action.id, action.slots);
      break;

    /**
     * Changes that have an impact on state.appState.isSavingPossible and happening
     * outside of a composer's expanded state need to dispatch actions that we'll
     * explicitly listen to here in order to react to those changes. Same applies
     * to changes that'd require App to re-render, we need to listen to those too.
     */
    case ActionTypes.COMPOSER_DRAFT_ATTACHMENT_TOGGLED:
    case ActionTypes.COMPOSER_UPDATE_DRAFT_CHARACTER_COUNT:
    case ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK:
    case ActionTypes.COMPOSER_UPDATE_DRAFTS_SOURCE_LINK:
    case ActionTypes.COMPOSER_UPDATE_DRAFT_SOURCE_LINK_DATA:
    case ActionTypes.COMPOSER_ENABLE:
    case ActionTypes.PROFILE_DROPDOWN_HIDDEN:
    case ActionTypes.UPDATE_DRAFT_ERROR_TYPE:
      isPayloadInteresting = true;
      break;

    default:
      isPayloadInteresting = false;
      break;
  }

  if (isPayloadInteresting) {
    updateIsSavingPossible();
    AppStore.emitChange();
  }
};

AppDispatcher.register(onDispatchedPayload);

export default AppStore;
