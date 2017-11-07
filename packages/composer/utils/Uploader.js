/**
 * Upload a file.
 *
 * Returns a Promise that resolves with an object literal containing the uploaded
 * image's url and its thumbnail url as well.
 */

import Request from '@bufferapp/buffer-js-request';
import RPCClient from 'micro-rpc-client';
import { MediaUploadConfig, MediaTypes, NotificationScopes } from '../AppConstants';
import AppStore from '../stores/AppStore';
import { getFileTypeFromUrl } from './StringUtils';
import NotificationActionCreators from '../action-creators/NotificationActionCreators';
import WebAPIUtils from './WebAPIUtils';
import WebSocket from './WebSocket';

let _xhr = null;
let _uploadProgressSub = () => {};

class Uploader {
  static upload(file) {
    return this::uploadToS3(file)
      .then(this::uploadToBuffer)
      .then(this::attachDimensions)
      .then(this::listenToProcessingEventsForVideos)
      .then(this::formatResponse);
  }

  static abort() {
    if (!Uploader.isUploading()) return;

    _xhr.abort();
    _xhr = null;
    _uploadProgressSub(0);
  }

  static getProgressIterator() {
    const progressGenerator = function* () {
      while (Uploader.isUploading()) {
        // eslint-disable-next-line no-loop-func
        yield new Promise((resolve) => { _uploadProgressSub = resolve; });
      }
    };

    return progressGenerator();
  }

  static isUploading = () => _xhr !== null;
}

function uploadToS3(file) {
  const formData = new FormData();

  const { id: userId, s3UploadSignature: userS3UploadSignature } = AppStore.getUserData();
  const url = `https://${userS3UploadSignature.bucket}.s3.amazonaws.com`;

  _xhr = new XMLHttpRequest(); // Use XHR to have access to a progress callback
  _uploadProgressSub = () => {};

  const timestamp = Date.now();
  const encodedFileName = encodeURIComponent(file.name);

  const data = [
    ['key', `${userId}/uploads/${timestamp}-${encodedFileName}`],
    ['Content-Type', 'video/mp4'], // Doesn't really matter for this first upload to S3
    ['acl', 'public-read'],
    ['success_action_status', userS3UploadSignature.successActionStatus],
    ['policy', userS3UploadSignature.base64Policy],
    ['X-amz-algorithm', userS3UploadSignature.algorithm],
    ['X-amz-credential', userS3UploadSignature.credentials],
    ['X-amz-date', userS3UploadSignature.date],
    ['X-amz-expires', userS3UploadSignature.expires],
    ['X-amz-signature', userS3UploadSignature.signature],
    ['file', file],
  ];

  data.forEach(([key, val]) => formData.append(key, val));

  const promise = new Promise((resolve) => {
    _xhr.open('POST', url, true);

    _xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    _xhr.addEventListener('readystatechange', () => {
      if (_xhr.readyState === 4 && (_xhr.status === 200 || _xhr.status === 201)) {
        const uploadKey = _xhr.responseXML.getElementsByTagName('Key')[0].textContent;
        resolve(uploadKey);

        _xhr = null;
        _uploadProgressSub(100);
      }
    });

    _xhr.addEventListener('error', () => {
      NotificationActionCreators.queueError({
        scope: NotificationScopes.FILE_UPLOAD,
        message: 'Uh oh! It looks like we had trouble connecting to our servers, mind trying again?',
      });
    });

    _xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = e.loaded / e.total * 100;
        _uploadProgressSub(progress);
      }
    });

    _xhr.send(formData);
  });

  return promise;
}

function uploadToBuffer(uploadKey) {
  const data = {
    key: uploadKey,
    csrf_token: AppStore.getCsrfToken(),
  };

  const { onNewPublish } = AppStore.getUserData();

  if (onNewPublish) {
    const rpc = new RPCClient({
      url: '/rpc',
      sendCredentials: 'same-origin',
    });
    const type = getMediaType(uploadKey);

    return rpc.call('composerApiProxy', {
      url: `/i/upload_${type === 'photo' ? 'image' : 'video'}.json`,
      args: data,
    })
     .then((response) => {
       response = { ...response, type };
       return response;
     })
     .then((response) => {
       if (response.success === false) {
         NotificationActionCreators.queueError({
           scope: NotificationScopes.FILE_UPLOAD,
           message: 'Uh oh! It looks like we had trouble connecting to our servers, mind trying again?',
         });
       }
       return response;
     });
  }


  const settings = {
    credentials: 'same-origin', // Send cookies with the req
  };

  return Request.post(MediaUploadConfig.endpoint, data, settings)
           .then((response) => response.json())
           .then((response) => {
             if (response.success === false) {
               NotificationActionCreators.queueError({
                 scope: NotificationScopes.FILE_UPLOAD,
                 message: 'Uh oh! It looks like we had trouble connecting to our servers, mind trying again?',
               });
             }
             return response;
           });
}

function attachDimensions(response) {
  if (response.type !== 'photo') {
    return response;
  }

  return WebAPIUtils.getImageDimensions(response.fullsize)
           .then(({ width, height }) => ({ ...response, width, height }))
           .catch(() => response);
}

function listenToProcessingEventsForVideos(response) {
  if (response.type === 'video') WebSocket.init();
  return response;
}

function formatResponse(response) {
  let formattedResponse;
  switch (response.type) {
    case 'photo':
      if (getFileTypeFromUrl(response.fullsize) === 'gif') {
        formattedResponse = {
          type: MediaTypes.GIF,
          url: response.fullsize,
          thumbnailUrl: response.thumbnail,
          success: response.success,
          width: response.width,
          height: response.height,
        };
      } else {
        formattedResponse = {
          type: MediaTypes.IMAGE,
          url: response.fullsize,
          thumbnailUrl: response.thumbnail,
          success: response.success,
          width: response.width,
          height: response.height,
        };
      }
      break;

    case 'video':
      formattedResponse = {
        type: MediaTypes.VIDEO,
        uploadId: response.upload_id,
        name: response.title,
        fileExtension: response.details && response.details.file_extension,
        success: response.success,
      };
      break;

    default:
      formattedResponse = {};
      break;
  }

  return formattedResponse;
}

function getMediaType(mediaString) {
  return mediaString.match(/[^/]+(jpg|jpeg|png|gif)$/) ? 'photo' : 'video';
}

export default Uploader;
