import React from 'react';
import PropTypes from 'prop-types';
import ComposerStore from '../stores/ComposerStore';
import Composer from '../components/Composer';
import styles from './css/ComposerSection.css';

const getComposerState = () => ({
  enabledDrafts: ComposerStore.getEnabledDrafts(),
  draftsSharedData: ComposerStore.getDraftsSharedData(),
  omniDraft: ComposerStore.getDraft('omni'),
});

class ComposerSection extends React.Component {
  static propTypes = {
    appState: PropTypes.object.isRequired,
    visibleNotifications: PropTypes.array.isRequired,
    areAllDraftsSaved: PropTypes.bool.isRequired,
    shouldEnableFacebookAutocomplete: PropTypes.bool.isRequired,
    shouldShowInlineSubprofileDropdown: PropTypes.bool.isRequired,
    profiles: PropTypes.array,
    selectedProfiles: PropTypes.array,
    showTwitterImageDescription: PropTypes.bool.isRequired,
    isOmniboxEnabled: PropTypes.bool,
    composerPosition: PropTypes.object,
  };

  static defaultProps = {
    isOmniboxEnabled: null,
    composerPosition: null,
  };

  state = getComposerState();

  componentDidMount = () => ComposerStore.addChangeListener(this.onStoreChange);
  componentWillUnmount = () => ComposerStore.removeChangeListener(this.onStoreChange);
  onStoreChange = () => this.setState(getComposerState());

  render() {
    const { enabledDrafts, draftsSharedData, omniDraft } = this.state;

    const {
      appState, profiles, visibleNotifications, areAllDraftsSaved, selectedProfiles,
      shouldEnableFacebookAutocomplete, showTwitterImageDescription,
      shouldShowInlineSubprofileDropdown, isOmniboxEnabled, composerPosition,
    } = this.props;

    const hasEnabledDrafts = enabledDrafts.length > 0 || isOmniboxEnabled;
    const composersHaveBeenExpanded = appState.composersHaveBeenExpanded;

    const getComposerComponent = (draft) => (
      <Composer
        appState={appState}
        draft={draft}
        key={draft.id}
        enabledDrafts={enabledDrafts}
        draftsSharedData={draftsSharedData}
        profiles={profiles}
        expandedComposerId={isOmniboxEnabled ? draft.id : appState.expandedComposerId}
        visibleNotifications={visibleNotifications}
        areAllDraftsSaved={areAllDraftsSaved}
        selectedProfiles={selectedProfiles}
        shouldEnableFacebookAutocomplete={shouldEnableFacebookAutocomplete}
        showTwitterImageDescription={showTwitterImageDescription}
        shouldShowInlineSubprofileDropdown={shouldShowInlineSubprofileDropdown}
        composerPosition={composerPosition}
      />
    );

    return (
      <div className={styles.composerSection}>
        {!hasEnabledDrafts && (
          <div className={styles.emptyState}>
            {composersHaveBeenExpanded ?
              'Your work has been saved. Please select a social account above to continue.' :
              'Please select a social account above to continue.'}
          </div>
        )}

        {isOmniboxEnabled &&
          getComposerComponent(omniDraft)}

        {!isOmniboxEnabled &&
          enabledDrafts.map(getComposerComponent)}
      </div>
    );
  }
}

export default ComposerSection;
