/**
 * Thin wrapper around @bufferapp/buffer-js-api that automatically
 * attaches the CSRF token to requests, and enforces absolute urls.
 */

import RPCClient from 'micro-rpc-client';

import BufferAPI from '@bufferapp/buffer-js-api';
import AppStore from '../stores/AppStore';
import { bufferOrigins } from '../AppConstants';

class API extends BufferAPI {
  static request(url, data = {}, settings, apiSettings = {}) {
    const { onNewPublish } = AppStore.getUserData();

    /**
     * The new publish dashboard uses an RPC client to
     * make authenticated requests to the Buffer API.
     * Since the composer is still quite siloed and depends
     * on the normal Buffer API we create another RPC client
     * to allow the composer to make proxied requests.
     */
    if (onNewPublish) {
      const rpc = new RPCClient({
        url: '/rpc',
        sendCredentials: 'same-origin',
      });

      return rpc.call('composerApiProxy', {
        url: `/1/${url}`,
        args: data,
      });
    }

    const { environment } = AppStore.getMetaData();

    const defaultData = {
      csrf_token: AppStore.getCsrfToken(),
    };

    data = Object.assign(defaultData, data);

    const defaultSettings = {
      endpoint: `${bufferOrigins.get(environment)}/api/`,
    };

    apiSettings = Object.assign(defaultSettings, apiSettings);

    return BufferAPI.request(url, data, settings, apiSettings);
  }
}

export default API;
