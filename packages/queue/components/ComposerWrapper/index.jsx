import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Composer, { formatInputData } from '@bufferapp/publish-composer';

// TODO: move this component to container directory since it's connected
const ComposerWrapper = ({
  userData,
  profiles,
  enabledApplicationModes,
  accessToken,
  onSave,
  environment,
}) => {
  const options = {
    canSelectProfiles: true,
    saveButtons: ['ADD_TO_QUEUE', 'SHARE_NOW'],
    position: { top: '10rem', left: '10rem' },
    onSave,
  };

  const metaData = {
    application: 'WEB_DASHBOARD',
    environment: `${environment === 'development' ? 'local' : 'production'}`,
    should_enable_fb_autocomplete:
      userData.features && userData.features.includes('mc_facebook_autocomplete'),
    should_show_twitter_alt_text:
      userData.features && userData.features.includes('twitter_alt_text'),
    should_use_new_twitter_autocomplete: enabledApplicationModes.includes('web-twitter-typeahead-autocomplete'),
  };

  const formattedData = formatInputData({
    env: metaData.application,
    data: {
      profiles,
      userData,
      metaData,
      csrfToken: '1234',
      update: {},
      imageDimensionsKey: userData.imageDimensionsKey,
    },
  });

  return (
    <div>
      <Composer
        profilesData={formattedData.profilesData}
        userData={formattedData.userData}
        metaData={formattedData.metaData}
        imageDimensionsKey={formattedData.imageDimensionsKey}
        options={options}
        accessToken={accessToken}
        onNewPublish
      />
    </div>
  );
};

ComposerWrapper.propTypes = {
  userData: PropTypes.shape({
    id: PropTypes.string.isRequired,
    s3_upload_signature: PropTypes.shape({}).isRequired,
    uses_24h_time: PropTypes.bool.isRequired,
    week_starts_monday: PropTypes.bool.isRequired,
    profile_groups: PropTypes.PropTypes.array,
    is_free_user: PropTypes.bool.isRequired,
    skip_empty_text_alert: PropTypes.bool.isRequired,
    is_business_user: PropTypes.bool.isRequired,
    imageDimensionsKey: PropTypes.string.isRequired,
  }).isRequired,
  profiles: PropTypes.arrayOf(PropTypes.object),
  enabledApplicationModes: PropTypes.arrayOf(PropTypes.string),
  accessToken: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  environment: PropTypes.string.isRequired,
};

ComposerWrapper.defaultProps = {
  profiles: [],
  enabledApplicationModes: [],
  csrfToken: '1234',
};

export default connect(
  (state) => {
    if (state.appSidebar && state.profileSidebar) {
      return ({
        userData: state.appSidebar.user,
        profiles: state.profileSidebar.profiles,
        enabledApplicationModes: state.queue.enabledApplicationModes,
        environment: state.queue.environment,
        accessToken: state.login.sessionToken,
      });
    }
    return {};
  },
)(ComposerWrapper);
