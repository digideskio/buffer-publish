/**
 * Utils used by scripts outside the MC bundle, i.e. in Buffer's dashboard.
 * The purpose of these scripts is mostly to handle MC's iframe and send data to MC.
 * See README at the root of /multiple-composers for higher-level architecture info.
 */

import { bufferOrigins, bufferOriginRegex } from './ExternalSharedAppConstants';

const getElRefOffset = (el, dir = 'top', ref = document.body) => {
  const offsetPosMethodName = (dir !== 'left') ? 'offsetTop' : 'offsetLeft';
  let offset = el[offsetPosMethodName];

  while ((el = el.offsetParent) !== ref) { // eslint-disable-line
    offset += el[offsetPosMethodName];
  }

  return offset;
};

let resolveIframePromise;
let rejectIframePromise;
let isIframeVisible = false;
let environment;
let onDraftsSaved;

const mcIframe = new Promise((resolve, reject) => {
  resolveIframePromise = resolve;
  rejectIframePromise = reject;
});

/**
 * Initialize MC from outside its iframe.
 *
 * Takes a bunch of data that serves to initialize MC in the proper state:
 *
 * @param {string} env - the environment from which data is imported (one of
 *                       DataImportEnvironments in AppContants)
 * @param {object} data - collection of data pieces with which to initialize MC
 * @param {array} data.profiles - collection of profiles to show in the profile selector,
 *                                including profiles to be selected by default
 * @param {object} data.bufferGlobal - the `buffer` global found in most environments, will
 *                                     be serialized to retrieve additional small pieces of data
 * @param {object} [data.update={}] - update object, if MC is to be prefilled with update data
 * @param {string} [data.subprofileId=null] - id of a subprofile to auto-select
 * @param {number} [data.scheduledAt=null] - timestamp to be used as the prefilled scheduled time
 * @param {boolean} [data.isPinnedToSlot=null] - is this update pinned to a schedule slot?
 * @param {object} [options={}] - options to govern the frame's and MC's behavior
 * @param {object} [options.domNode=null] - any DOM element that MC should be positioned on top of;
 *                                          if not provided, MC will be positioned like a modal
 * @param {object} [options.canSelectProfiles=true] - should profiles be visible and selectable?
 * @param {object} [options.saveButtons] - what save options should be available; defaults to
 *                                         ['ADD_TO_QUEUE','SHARE_NEXT','SHARE_NOW','SCHEDULE_POST']
 * @param {object} [options.onSave] - callback function to execute when updates are saved
 */
const init = ({
  env,
  data: {
    profiles,
    bufferGlobal,
    update = {},
    subprofileId = null,
    scheduledAt = null,
    isPinnedToSlot = null,
  },
  options: {
    domNode = null,
    canSelectProfiles,
    saveButtons,
    onSave = () => {},
  } = {},
}) => {
  onDraftsSaved = onSave;

  const shouldAttachToDomNode = domNode !== null;

  const windowPosition = shouldAttachToDomNode ? {
    top: getElRefOffset(domNode, 'top'),
    left: getElRefOffset(domNode, 'left'),
  } : {
    top: document.body.scrollTop + 40,
  };

  const { userData, metaData, csrfToken, imageDimensionsKey } =
    extractSerializablePropsFromBufferGlobal(env, bufferGlobal);

  environment = metaData.environment;

  mcIframe.then((iframe) => {
    iframe.contentWindow.postMessage({
      type: 'init',
      env,
      data: {
        profiles,
        userData,
        metaData,
        csrfToken,
        imageDimensionsKey,
        update,
        subprofileId,
        scheduledAt,
        isPinnedToSlot,
      },
      options: { canSelectProfiles, saveButtons, position: windowPosition },
    }, bufferOrigins.get(environment));

    iframe.style.display = 'block';
    isIframeVisible = true;
  });
};

const hide = () => {
  mcIframe.then((iframe) => {
    if (!isIframeVisible) return;

    iframe.contentWindow.postMessage({
      type: 'reset',
    }, bufferOrigins.get(environment));

    iframe.style.display = 'none';
    isIframeVisible = false;
  });
};

const onIframeMessage = (e) => {
  const isBufferOrigin = bufferOriginRegex.test(e.origin);
  if (!isBufferOrigin) return;

  switch (e.data.type) {
    // If users mousedown inside the editor, select some text and then mouseup
    // outside the app's window, this action will also trigger a click, which would
    // hide the composer. We double-check a click doesn't follow the action
    // of selecting text before hiding the composer.
    case 'backdrop-click': {
      mcIframe.then((iframe) => {
        const isClickFollowingSelection = iframe.contentWindow.getSelection().toString().length > 0;
        if (!isClickFollowingSelection) hide();
      });
      break;
    }

    case 'drafts-saved':
      hide();
      onDraftsSaved();
      break;

    default:
      break;
  }
};

// Setup MC iframe by inserting it into the DOM and waiting for it to load
const setup = () => {
  const frameId = 'multiple-composers-iframe';

  if (document.getElementById(frameId) !== null) {
    rejectIframePromise('Can\'t setup Multiple Composers iframe: frame already setup');
  }

  const iframe = document.createElement('iframe');
  iframe.id = frameId;
  iframe.src = 'https://local.buffer.com/add?app=WEB';
  iframe.style.display = 'none';
  iframe.style.position = 'absolute';
  iframe.style.top = 0;
  iframe.style.left = 0;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
  iframe.style.zIndex = 9999999999999;

  iframe.addEventListener('load', () => resolveIframePromise(iframe));
  iframe.addEventListener('error', rejectIframePromise);

  window.addEventListener('message', onIframeMessage);

  document.body.appendChild(iframe);
};

/**
 * The buffer global has a complex data structure which makes it unserializable.
 * This method extracts serializable versions of the values we're interested in
 * so that we're able to send them over postMessage. Those values are formatted
 * later in DataImportUtils.js
 */
function extractSerializablePropsFromBufferGlobal(env, bufferGlobal) {
  const unfilteredUserData = bufferGlobal.data.user.toJSON();

  return {
    userData: {
      id: unfilteredUserData._id,
      s3_upload_signature: unfilteredUserData.s3_upload_signature,
      uses_24h_time: unfilteredUserData.twentyfour_hour_time,
      week_starts_monday: unfilteredUserData.week_starts_monday,
      profile_groups: unfilteredUserData.profile_groups,
      is_free_user: bufferGlobal.data.user.isFree(),
      skip_empty_text_alert:
        bufferGlobal.data.user.hasReadMessage('remember_confirm_saving_modal'),
      is_business_user: ( // Same logic as user_model.php#onBusinessPlan()
        unfilteredUserData.features.includes('improved_analytics') ||
        (unfilteredUserData.plan_code >= 10 && unfilteredUserData.plan_code <= 19)
      ),
    },
    metaData: {
      application: bufferGlobal.application,
      environment: bufferGlobal.environment,
      should_enable_fb_autocomplete:
        bufferGlobal.data.user.hasFeature('mc_facebook_autocomplete'),
      should_show_twitter_alt_text:
        bufferGlobal.data.user.hasFeature('twitter_alt_text'),
      should_use_new_twitter_autocomplete:
        bufferGlobal.data.enabled_application_modes
        .includes('web-twitter-typeahead-autocomplete'),
      should_show_rollout_tooltip: false,
    },
    csrfToken: bufferGlobal.csrf,
    imageDimensionsKey: bufferGlobal.data.imagedimensions_key,
  };
}

export { setup, init, hide };
