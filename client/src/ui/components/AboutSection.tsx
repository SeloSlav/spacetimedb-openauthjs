/**
 * AboutSection - About content for the login/landing page.
 * Uses theme CSS from client/src/theme.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { uiTheme } from '../../theme/uiTheme.ts';

interface AboutSectionProps {
  onFaqClick: () => void;
}

const AboutSection: React.FC<AboutSectionProps> = ({ onFaqClick }) => (
  <div
    data-about-section
    className={`${uiTheme.contentCard} stdb-about-section`}
  >
    <div className={`${uiTheme.sectionLabel} stdb-section-label-spaced`}>
      ABOUT
    </div>

    <h2 className="stdb-about-h2">
      SPACETIMEDB<br />
      AUTH DEMO
    </h2>

    <p className="stdb-about-p">
      <strong>SpacetimeDB Auth Demo</strong> shows login, username selection, and logout with <strong>SpacetimeDB</strong>, <strong>OpenAuth</strong>, and <strong>Hono</strong>.
      Sign in with your email, choose a username, and see a welcome message. The app demonstrates token-based auth for SpacetimeDB.
    </p>

    <p className={`stdb-about-p stdb-about-p-secondary`}>
      See the project{' '}
      <a
        href="https://github.com/SeloSlav/spacetimedb-openauthjs/blob/main/README.md"
        target="_blank"
        rel="noopener noreferrer"
        className="stdb-link"
      >
        README
      </a>
      {' '}for setup. Run <code className={uiTheme.code}>spacetime start</code>, the auth server, and <code className={uiTheme.code}>npm run dev</code>.{' '}
      <button type="button" onClick={onFaqClick} className="stdb-link-btn">
        See FAQ for details
      </button>
    </p>

    <p className={`stdb-about-p stdb-about-p-secondary`}>
      This demo is released under the{' '}
      <Link to="/license" className="stdb-link">
        MIT License
      </Link>
      {' '}and includes a{' '}
      <Link to="/disclaimer" className="stdb-link">
        project disclaimer
      </Link>
      .
    </p>
  </div>
);

export default AboutSection;
