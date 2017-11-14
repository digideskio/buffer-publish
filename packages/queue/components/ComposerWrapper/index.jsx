import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import Composer, { formatInputData } from '@bufferapp/publish-composer';

// TODO: move this component to container directory since it's connected
const ComposerWrapper = ({
  userData,
  profiles,
  enabledApplicationModes,
  onSave,
  environment,
  editMode,
  post,
}) => {
  const saveButtons = editMode ? ['SAVE'] : ['ADD_TO_QUEUE', 'SHARE_NOW'];

  const options = {
    canSelectProfiles: !editMode,
    saveButtons,
    position: { top: '10rem', left: '10rem' },
    onSave,
  };

  const metaData = {
    application: 'WEB_DASHBOARD',
    environment: `${environment === 'development' ? 'local' : 'production'}`,
    should_enable_fb_autocomplete:
      userData.features && userData.features.includes('mc_facebook_autocomplete'),
    // TODO: enabledApplicationModes.includes('web-twitter-typeahead-autocomplete'),
    should_use_new_twitter_autocomplete: false,
    updateId: post ? post.id : undefined,
    update: { ...post, images: post.imageUrls },
    subprofileId: post ? post.subprofile_id : undefined,
    due_at: post ? post.due_at : undefined,
    scheduled_at: post ? post.scheduled_at : undefined,
    pinned: post ? post.pinned : undefined,
  };
  const formattedData = formatInputData({
    env: metaData.application,
    data: {
      profiles,
      userData,
      metaData,
      csrfToken: '1234', // dummy string for now since MC requires csrfToken
      update: { ...post, images: post.imageUrls },
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
  onSave: PropTypes.func.isRequired,
  environment: PropTypes.string.isRequired,
  editMode: PropTypes.bool.isRequired,
  post: PropTypes.shape({}),
};

ComposerWrapper.defaultProps = {
  profiles: [],
  enabledApplicationModes: [],
  csrfToken: '1234',
  post: {},
};

export default connect(
  (state) => {
    if (state.appSidebar && state.profileSidebar) {
      const selectedProfileId = state.profileSidebar.selectedProfileId;
      const postId = state.queue.editingPostId;
      return ({
        userData: state.appSidebar.user,
        profiles: state.profileSidebar.profiles,
        enabledApplicationModes: state.enabledApplicationModes,
        environment: state.queue.environment,
        editMode: state.queue.editMode,
        post: state.queue.byProfileId[selectedProfileId].posts[postId],
      });
    }
    return {};
  },
)(ComposerWrapper);
