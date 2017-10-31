/**
 * keyMirror mirrors the object's keys as values, e.g. { EXAMPLE_VAL: null } will
 * become { EXAMPLE_VAL: 'EXAMPLE_VAL' }
 */

import keyMirror from 'keymirror';

const AppEnvironments = keyMirror({
  EXTENSION: null,
  WEB_DASHBOARD: null,
  ONBOARDING: null,
});

const DataImportEnvironments = keyMirror({
  BOOKMARKLET_PHP: null, // The document at /add, served through bookmarklet.php
  WEB_DASHBOARD: null, // Anywhere in the web dashboard
});

const MediaTypes = keyMirror({
  IMAGE: null,
  VIDEO: null,
  GIF: null,
});

const AttachmentTypes = keyMirror({
  LINK: null,
  MEDIA: null,
  RETWEET: null,
});

const LinkAttachmentTextFieldTypes = keyMirror({
  TITLE: null,
  DESCRIPTION: null,
});

const ErrorTypes = keyMirror({
  INLINE: null,
  FLOATING: null,
});

const FloatingErrorCodes = [
  401, 403, 404, 405, 429, 1000, 1001, 1002,
  1003, 1005, 1006, 1007, 1042, 1050, 1051,
];

const InlineErrorTypes = keyMirror({
  FIXABLE: null,
});

const ComposerInitiators = {
  ImageBufferButtons: [
    'hover_button_image',
    'menu-image',
  ],
};

const UploadTypes = keyMirror({
  LINK_THUMBNAIL: null,
  MEDIA: null,
});

const Services = (() => {
  const Service = class {
    constructor(config) {
      const defaultConfig = {
        name: null,
        formattedName: null,
        charLimit: null,
        doesRequireHumanInteractionToUpdateText: false,
        unavailableAttachmentTypes: [],
        requiredAttachmentType: null,
        unavailableMediaAttachmentTypes: [],
        maxAttachableImagesCount: 1,
        profileType: null,
        nativeVideoSizeLimit: null,
        nativeVideoDurationLimit: null,
        hasSubprofiles: false,
        canHaveSourceUrl: false,
        requiresText: false,
        canEditLinkAttachment: false,
        usesImageFirstLayout: false,
        isOmni: false,
      };

      Object.assign(this, defaultConfig, config);
    }

    canHaveAttachmentType = (type) => !this.unavailableAttachmentTypes.includes(type);
    canHaveSomeAttachmentType = (types) => types.some((type) => this.canHaveAttachmentType(type));

    canHaveMediaAttachmentType = (type) => !this.unavailableMediaAttachmentTypes.includes(type);
    canHaveSomeMediaAttachmentTypes = (types) =>
      types.some((type) => this.canHaveMediaAttachmentType(type));
  };

  const ProfileTypes = {
    ACCOUNT: {
      formattedName: 'account',
      formattedPluralName: 'accounts',
    },
    PAGE: {
      formattedName: 'page',
      formattedPluralName: 'pages',
    },
    OMNI: {
      formattedName: 'omni',
      formattedPluralName: '',
    },
  };

  const ServicesList = [
    new Service({
      name: 'omni',
      formattedName: 'Omni',
      profileType: ProfileTypes.OMNI,
      isOmni: true,
      maxAttachableImagesCount: 4,
      canEditLinkAttachment: true,
    }),
    new Service({
      name: 'twitter',
      formattedName: 'Twitter',
      charLimit: 140,
      unavailableAttachmentTypes: [AttachmentTypes.LINK],
      maxAttachableImagesCount: 4,
      profileType: ProfileTypes.ACCOUNT,
      nativeVideoSizeLimit: 512 * 1024 * 1024, // 512MB
      nativeVideoDurationLimit: 140, // 140s
    }),
    new Service({
      name: 'facebook',
      formattedName: 'Facebook',
      unavailableAttachmentTypes: [AttachmentTypes.RETWEET],
      maxAttachableImagesCount: 4,
      doesRequireHumanInteractionToUpdateText: true,
      profileType: ProfileTypes.ACCOUNT,
      canEditLinkAttachment: true,
    }),
    new Service({
      name: 'instagram',
      charLimit: 2200,
      formattedName: 'Instagram',
      unavailableAttachmentTypes: [AttachmentTypes.LINK, AttachmentTypes.RETWEET],
      requiredAttachmentType: AttachmentTypes.MEDIA,
      unavailableMediaAttachmentTypes: [MediaTypes.GIF],
      profileType: ProfileTypes.ACCOUNT,
      usesImageFirstLayout: true,
    }),
    new Service({
      name: 'linkedin',
      charLimit: 600,
      formattedName: 'LinkedIn',
      unavailableAttachmentTypes: [AttachmentTypes.RETWEET],
      unavailableMediaAttachmentTypes: [MediaTypes.GIF],
      profileType: ProfileTypes.ACCOUNT,
      canEditLinkAttachment: true,
    }),
    new Service({
      name: 'pinterest',
      formattedName: 'Pinterest',
      unavailableAttachmentTypes: [AttachmentTypes.LINK, AttachmentTypes.RETWEET],
      requiredAttachmentType: AttachmentTypes.MEDIA,
      profileType: ProfileTypes.ACCOUNT,
      hasSubprofiles: true,
      charLimit: 500,
      canHaveSourceUrl: true,
      requiresText: true,
      usesImageFirstLayout: true,
    }),
    new Service({
      name: 'google',
      formattedName: 'Google+',
      profileType: ProfileTypes.PAGE,
      unavailableAttachmentTypes: [AttachmentTypes.RETWEET],
    }),
    new Service({
      name: 'appdotnet',
      formattedName: 'App.net',
      unavailableAttachmentTypes: [AttachmentTypes.LINK],
      unavailableMediaAttachmentTypes: [MediaTypes.GIF],
      profileType: ProfileTypes.ACCOUNT,
    }),
  ];

  ServicesList.get = (serviceName) => ServicesList.find((service) => service.name === serviceName);

  return ServicesList;
})();

const QueueingTypes = keyMirror({
  QUEUE: null,
  NEXT: null,
  NOW: null,
  CUSTOM: null,
  SAVE: null,
  SAVE_AND_APPROVE: null,
  ADD_DRAFT: null,
  NEXT_DRAFT: null,
  CUSTOM_DRAFT: null,
});

const SaveButtonTypes = keyMirror({
  ADD_TO_QUEUE: null,
  SHARE_NEXT: null,
  SHARE_NOW: null,
  SCHEDULE_POST: null,
  SAVE: null,
  SAVE_AND_APPROVE: null,
  ADD_TO_DRAFTS: null,
  SHARE_NEXT_DRAFT: null,
  SCHEDULE_DRAFT: null,
});

const InlineSaveButtonTypes = [
  SaveButtonTypes.SAVE,
  SaveButtonTypes.SAVE_AND_APPROVE,
];

const ButtonsQueuingTypesMap = new Map([
  [SaveButtonTypes.ADD_TO_QUEUE, QueueingTypes.QUEUE],
  [SaveButtonTypes.SHARE_NEXT, QueueingTypes.NEXT],
  [SaveButtonTypes.SHARE_NOW, QueueingTypes.NOW],
  [SaveButtonTypes.SCHEDULE_POST, QueueingTypes.CUSTOM],
  [SaveButtonTypes.SAVE, QueueingTypes.SAVE],
  [SaveButtonTypes.SAVE_AND_APPROVE, QueueingTypes.SAVE_AND_APPROVE],
  [SaveButtonTypes.ADD_TO_DRAFTS, QueueingTypes.ADD_DRAFT],
  [SaveButtonTypes.SHARE_NEXT_DRAFT, QueueingTypes.NEXT_DRAFT],
  [SaveButtonTypes.SCHEDULE_DRAFT, QueueingTypes.CUSTOM_DRAFT],
]);

const ActionTypes = keyMirror({
  APP_RESET: null,
  APP_RECEIVE_USER_DATA: null,
  APP_RECEIVE_METADATA: null,
  APP_RECEIVE_OPTIONS: null,
  APP_RECEIVE_CSRF_TOKEN: null,
  APP_RECEIVE_IMAGE_DIMENSIONS_KEY: null,
  APP_RECEIVE_TWITTER_AUTOCOMPLETE_BOOTSTRAP_DATA: null,
  COMPOSER_CREATE_PROFILES: null,
  COMPOSER_SET_DRAFTS_INITIAL_TEXT: null,
  COMPOSER_UPDATE_DRAFT_EDITOR_STATE: null,
  COMPOSER_UPDATE_DRAFT_CHARACTER_COUNT: null,
  COMPOSER_UPDATE_DRAFT_SOURCE_LINK: null,
  COMPOSER_UPDATE_DRAFTS_SOURCE_LINK: null,
  COMPOSER_UPDATE_DRAFT_SOURCE_LINK_DATA: null,
  COMPOSER_UPDATE_DRAFT_LINK_DATA: null,
  COMPOSER_UPDATE_DRAFTS_LINK_DATA: null,
  COMPOSER_ADD_DRAFT_IMAGE: null,
  COMPOSER_ADD_DRAFTS_IMAGE: null,
  COMPOSER_DRAFT_IMAGE_ADDED: null,
  COMPOSER_REMOVE_DRAFT_IMAGE: null,
  APP_SELECT_SUBPROFILE: null,
  APP_SELECT_SUBPROFILES: null,
  APP_UNSELECT_SUBPROFILE: null,
  COMPOSER_ADD_DRAFT_VIDEO: null,
  COMPOSER_ADD_DRAFT_GIF: null,
  COMPOSER_ADD_DRAFTS_GIF: null,
  COMPOSER_DRAFT_VIDEO_ADDED: null,
  COMPOSER_DRAFT_GIF_ADDED: null,
  COMPOSER_REMOVE_DRAFT_VIDEO: null,
  COMPOSER_REMOVE_DRAFT_GIF: null,
  COMPOSER_UPDATE_DRAFT_TEMP_IMAGE: null,
  COMPOSER_REMOVE_DRAFT_TEMP_IMAGE: null,
  COMPOSER_ADD_DRAFTS_RETWEET: null,
  COMPOSER_SAVE_DRAFTS: null,
  COMPOSER_RECEIVE_SAVED_DRAFTS: null,
  COMPOSER_SELECT_PROFILES_ON_BEHALF_OF_USER: null,
  COMPOSER_SELECT_PROFILE: null,
  COMPOSER_SELECT_PROFILES: null,
  COMPOSER_QUEUE_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND: null,
  COMPOSER_EMPTY_PROFILES_SUBPROFILES_DROPDOWNS_TO_EXPAND: null,
  COMPOSER_UNSELECT_PROFILE: null,
  COMPOSER_UNSELECT_PROFILES: null,
  COMPOSER_EXPAND: null,
  COMPOSER_COLLAPSE: null,
  COMPOSER_TOGGLE_DRAFT_ATTACHMENT: null,
  COMPOSER_ENABLE_DRAFTS_ATTACHMENT: null,
  COMPOSER_DRAFT_ATTACHMENT_TOGGLED: null,
  COMPOSER_ENABLE: null,
  COMPOSER_DISABLE: null,
  COMPOSER_PARSE_DRAFT_TEXT_LINKS: null,
  COMPOSER_PARSE_DRAFTS_TEXT_LINKS: null,
  COMPOSER_HANDLE_NEW_DRAFT_TEXT_LINKS: null,
  COMPOSER_HANDLE_REMOVED_DRAFT_TEXT_LINKS: null,
  COMPOSER_DRAFT_LINK_SHORTENED: null,
  COMPOSER_DRAFT_LINK_UNSHORTENED: null,
  COMPOSER_DRAFT_LINK_RESHORTENED: null,
  COMPOSER_ADD_DRAFT_AVAILABLE_IMAGES: null,
  COMPOSER_REMOVE_DRAFT_AVAILABLE_IMAGES: null,
  COMPOSER_DRAFT_FILE_UPLOAD_STARTED: null,
  COMPOSER_DRAFT_FILE_UPLOAD_PROGRESS: null,
  COMPOSER_ADD_DRAFT_UPLOADED_IMAGE: null,
  COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_IMAGE: null,
  COMPOSER_ADD_DRAFT_UPLOADED_GIF: null,
  COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_GIF: null,
  COMPOSER_ADD_DRAFT_UPLOADED_VIDEO: null,
  COMPOSER_ADD_DRAFTS_AUTO_UPLOADED_VIDEO: null,
  COMPOSER_VIDEO_PROCESSED: null,
  COMPOSER_UPDATE_DRAFTS_SCHEDULED_AT: null,
  COMPOSER_CREATE_NEW_SUBPROFILE: null,
  COMPOSER_CREATE_NEW_SUBPROFILE_PENDING: null,
  COMPOSER_CREATE_NEW_SUBPROFILE_FAILED: null,
  PROFILE_DROPDOWN_HIDDEN: null,
  COMPOSER_COLLAPSE_PROFILE_SUBPROFILE_DROPDOWN: null,
  COMPOSER_EXPAND_PROFILE_SUBPROFILE_DROPDOWN: null,
  APP_SELECT_GROUP_PROFILES: null,
  APP_UNSELECT_GROUP_PROFILES: null,
  COMPOSER_PROFILE_GROUP_CREATED: null,
  COMPOSER_PROFILE_GROUP_UPDATED: null,
  COMPOSER_PROFILE_GROUP_DELETED: null,
  APP_RECEIVE_PROFILE_SLOT_DATA: null,
  QUEUE_NOTIFICATION: null,
  REMOVE_NOTIFICATION: null,
  APP_TOGGLE_ALL_PROFILES: null,
  APP_REFRESH_SUBPROFILE_DATA: null,
  COMPOSER_ADD_DRAFT_UPLOADED_LINK_THUMBNAIL: null,
  COMPOSER_UPDATE_DRAFT_LINK_THUMBNAIL: null,
  COMPOSER_UPDATE_PREVIOUS_LINK_THUMBNAIL: null,
  COMPOSER_UPDATE_NEXT_LINK_THUMBNAIL: null,
  UPDATE_DRAFT_ERROR_TYPE: null,
  COMPOSER_CLEAR_INLINE_ERRORS: null,
  UPDATE_DRAFT_IS_SAVED: null,
  REMEMBER_MODAL_VIEW: null,
  APP_LOADED: null,
  COMPOSER_APPLY_OMNI_UPDATE: null,
  APP_UPDATE_OMNIBOX_COMPOSER_STATE: null,
  REMOVE_ALL_NOTIFICATIONS_BY_SCOPE: null,
  REMOVE_COMPOSER_NOTICES: null,
  COMPOSER_UPDATE_IMAGE_DESCRIPTION: null,
  COMPOSER_UPDATE_UPLOADED_IMAGE_DIMENSIONS: null,
  COMPOSER_DRAFTS_PREVENT_AUTO_ATTACHING_URLS: null,
});

const AsyncOperationStates = keyMirror({
  PENDING: null,
  DONE: null,
});

const NotificationTypes = keyMirror({
  INFO: null,
  SUCCESS: null,
  ERROR: null,
});

const NotificationScopes = keyMirror({
  BOARD_CREATION: null,
  FILE_UPLOAD: null,
  UPDATE_SAVING_AGGREGATE: null,
  UPDATE_SAVING: null,
  AUTOCOMPLETE: null,
  COMPOSER_NOTICE_NOT_PREFILLED: null,
  MC_OMNIBOX_EDIT_NOTICE: null,
});

/**
 * This is a map of maps, allowing to quickly access a content type group's
 * allowed formats as keys, and that format's specifics in an object literal:
 *
 * FileUploadFormatsConfigs = {
 *   IMAGE: Map {
 *     'JPG' => { maxSize: 10 * 1024 * 1024 },
 *     'JPEG' => { maxSize: 10 * 1024 * 1024 },
 *     'PNG' => { maxSize: 10 * 1024 * 1024 }
 *   },
 *   ...
 * }
 */
const FileUploadFormatsConfigs = (() => {
  const contentTypeConfigs = {
    JPG: { maxSize: 10 * 1024 * 1024 },
    JPEG: { maxSize: 10 * 1024 * 1024 },
    GIF: { maxSize: 10 * 1024 * 1024 },
    PNG: { maxSize: 10 * 1024 * 1024 },
    MP4: { maxSize: 1024 * 1024 * 1024 },
    MOV: { maxSize: 1024 * 1024 * 1024 },
    AVI: { maxSize: 1024 * 1024 * 1024 },
  };

  const contentTypeGroups = new Map([
    ['IMAGE', ['JPG', 'JPEG', 'PNG']],
    ['VIDEO', ['MOV', 'MP4', 'AVI']],
    ['GIF', ['GIF']],
    ['MEDIA', ['JPG', 'JPEG', 'GIF', 'PNG', 'MOV', 'MP4', 'AVI']],
  ]);

  const FileUploadFormatsConfigsMap = {};

  contentTypeGroups.forEach((contentTypes, groupName) => {
    const groupConfig = new Map();
    contentTypes.forEach((contentType) =>
      groupConfig.set(contentType, contentTypeConfigs[contentType]));
    FileUploadFormatsConfigsMap[groupName] = groupConfig;
  });

  return FileUploadFormatsConfigsMap;
})();

const MediaUploadConfig = {
  endpoint: '/upload/media',
};

export {
  Services, AttachmentTypes, QueueingTypes, ActionTypes, AsyncOperationStates,
  NotificationTypes, NotificationScopes, FileUploadFormatsConfigs, MediaUploadConfig,
  MediaTypes, AppEnvironments, UploadTypes, ComposerInitiators, LinkAttachmentTextFieldTypes,
  FloatingErrorCodes, ErrorTypes, InlineErrorTypes, SaveButtonTypes,
  InlineSaveButtonTypes, ButtonsQueuingTypesMap, DataImportEnvironments,
};

export { bufferOrigins, bufferOriginRegex } from './external/ExternalSharedAppConstants';
