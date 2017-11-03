/* global Pusher */
/**
 * Scrape urls to retrieve information about them.
 *
 * Returns a Promise that resolves with the JSON response from WebSocket.url as
 * an object literal.
 *
 * Results are cached, and a same request done simultaneously will be
 * queued to return the same info as the already-running request.
 */

import InternalPusher from 'pusher-js';
import ServerActionCreators from '../action-creators/ServerActionCreators';
import AppStore from '../stores/AppStore';
import { AppEnvironments } from '../AppConstants';

const handleTranscodedVideo = (data) => {
  ServerActionCreators.videoProcessed({
    uploadId: data.upload_id,
    name: data.media.video.title,
    duration: data.media.video.details.duration,
    durationMs: data.media.video.details.duration_millis,
    size: data.media.video.details.file_size,
    width: data.media.video.details.width,
    height: data.media.video.details.height,
    url: data.media.video.details.transcoded_location,
    originalUrl: data.media.video.details.location,
    thumbnail: data.media.thumbnail,
    availableThumbnails: data.media.video.thumbnails,
  });
};

const handleCreatedProfileGroup = ({ id, name, profile_ids }) => {
  ServerActionCreators.profileGroupCreated({
    id,
    name,
    profileIds: profile_ids,
  });
};

const handleEditedProfileGroup = ({ id, name, profile_ids }) => {
  ServerActionCreators.profileGroupUpdated({
    id,
    name,
    profileIds: profile_ids,
  });
};

const handleDeletedProfileGroup = ({ id }) => {
  ServerActionCreators.profileGroupDeleted({
    id,
  });
};

const eventHandlers = new Map([
  ['transcode_done', handleTranscodedVideo],
  ['created_profile_group', handleCreatedProfileGroup],
  ['edited_profile_group', handleEditedProfileGroup],
  ['deleted_profile_group', handleDeletedProfileGroup],
]);

class WebSocket {
  static PUSHER_API_KEY = 'bd9ba9324ece3341976e';
  static PUSHER_AUTH_ENDPOINT = '/pusher_receiver/auth';

  static init = (() => {
    const hasWebSocketConnectionOpen = false; // Only one connection's necessary

    return () => {
      const { appEnvironment } = AppStore.getMetaData();
      const isDashboardEnv = appEnvironment === AppEnvironments.WEB_DASHBOARD;
      let pusherInstance;

      // Reuse existing Pusher connection on dashboard
      if (isDashboardEnv) {
        pusherInstance = InternalPusher.instances[0];
      // Create new Pusher connection in extension
      } else {
        if (hasWebSocketConnectionOpen) return;

        const userId = AppStore.getUserData().id;

        // Pusher.channel_auth_endpoint = WebSocket.PUSHER_AUTH_ENDPOINT;
        window.__pusher.channel_auth_endpoint = WebSocket.PUSHER_AUTH_ENDPOINT;
        const pusher = new Pusher(WebSocket.PUSHER_API_KEY);
        pusherInstance = pusher.subscribe(`private-updates-${userId}`);
      }

      eventHandlers.forEach((handler, event) => pusherInstance.bind(event, handler));
    };
  })();

  static cleanUp = () => {
    const { appEnvironment } = AppStore.getMetaData();
    const isDashboardEnv = appEnvironment === AppEnvironments.WEB_DASHBOARD;
    let pusherInstance;

    if (isDashboardEnv) {
      pusherInstance = InternalPusher.instances[0];
    } else {
      pusherInstance = window.__pusher;
    }

    eventHandlers.forEach((handler, event) => pusherInstance.unbind(event, handler));
  };
}

export default WebSocket;
