import React from 'react';
import PropTypes from 'prop-types';
import { Popover } from '@bufferapp/components';
import ComposerWrapper from '../ComposerWrapper';

const ComposerPopover = ({
  onSave,
  transparentOverlay,
  preserveComposerStateOnClose,
}) => (
  <Popover
    left={'21rem'}
    top={'4.7rem'}
    transparentOverlay={transparentOverlay}
    onOverlayClick={onSave}
  >
    <ComposerWrapper
      onSave={onSave}
      preserveStateOnClose={preserveComposerStateOnClose}
    />
  </Popover>
);

ComposerPopover.propTypes = {
  onSave: PropTypes.func.isRequired,
  transparentOverlay: PropTypes.bool,
  preserveComposerStateOnClose: PropTypes.bool,
};

ComposerPopover.defaultProps = {
  transparentOverlay: false,
  preserveComposerStateOnClose: false,
};

export default ComposerPopover;
