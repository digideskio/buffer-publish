/**
 * Component that displays a link attachment
 */

import React from 'react';
import PropTypes from 'prop-types';
import AppActionCreators from '../action-creators/AppActionCreators';
import ComposerActionCreators from '../action-creators/ComposerActionCreators';
import LinkAttachmentTextEditor from '../components/LinkAttachmentTextEditor';
import LinkAttachmentThumbnailEditor from '../components/LinkAttachmentThumbnailEditor';
import LinkAttachmentThumbnail from '../components/LinkAttachmentThumbnail';
import CloseButton from '../components/CloseButton';
import A from '../components/A';
import { AttachmentTypes, LinkAttachmentTextFieldTypes } from '../AppConstants';
import styles from './css/LinkAttachment.css';
import { getAbsoluteUrl } from '../utils/StringUtils';


class LinkAttachment extends React.Component {
  static propTypes = {
    draftId: PropTypes.string.isRequired,
    link: PropTypes.object.isRequired,
    service: PropTypes.object,
    visibleNotifications: PropTypes.array,
    filesUploadProgress: PropTypes.instanceOf(Map),
  };

  onCloseButtonClick = () => {
    ComposerActionCreators.toggleAttachment(this.props.draftId, AttachmentTypes.LINK);

    AppActionCreators.trackUserAction(['composer', 'attachment', 'disabled'], {
      attachment_type: AttachmentTypes.LINK,
      button_clicked: 'close_button',
    });
  };

  render() {
    const { link, draftId, service, visibleNotifications, filesUploadProgress } = this.props;
    const canEditLinkAttachment = service.canEditLinkAttachment;
    const hasTitle = link.title !== null;
    const hasDescription = link.description !== null;
    const areUploadsInProgress = filesUploadProgress.size > 0;
    const absoluteUrl = getAbsoluteUrl(link.url);
    const domainOnlyUrl =
      link.url.replace('http://', '')
      .replace('www.', '')
      .replace('https://', '')
      .split(/[/?#]/)[0];


    return (
      <div className={styles.linkAttachment}>
        <LinkAttachmentThumbnail
          thumbnail={link.thumbnail}
          isUploadInProgress={areUploadsInProgress}
        />

        {canEditLinkAttachment &&
          <LinkAttachmentThumbnailEditor
            draftId={draftId}
            selectedThumbnail={link.thumbnail}
            availableThumbnails={link.availableThumbnails}
            visibleNotifications={visibleNotifications}
            service={service}
            filesUploadProgress={filesUploadProgress}
          />}

        <span className={styles.linkDetailsContainer}>
          {hasTitle ?
            <LinkAttachmentTextEditor
              type={LinkAttachmentTextFieldTypes.TITLE}
              value={link.title} draftId={draftId} canBeEdited={canEditLinkAttachment}
            /> :
            <p className={styles.loadingMessage} />}

          <A className={styles.url} href={absoluteUrl} target="_blank">{domainOnlyUrl}</A>

          {hasDescription &&
            <LinkAttachmentTextEditor
              type={LinkAttachmentTextFieldTypes.DESCRIPTION}
              value={link.description} draftId={draftId} canBeEdited={canEditLinkAttachment}
            />}
        </span>

        <CloseButton
          className={styles.closeButton}
          onClick={this.onCloseButtonClick}
          data-tip="Disable Link Attachment"
        />
      </div>
    );
  }
}

export default LinkAttachment;
