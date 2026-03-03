/**
 * DisclaimerPage.tsx
 * Displays project disclaimer and liability waiver information.
 */

import { useNavigate } from 'react-router-dom';
import './DisclaimerPage.css';

const DISCLAIMER_TEXT = `Project Disclaimer

This project is a personal, community-built demo and is provided for educational purposes.

No Official Affiliation

This project is NOT affiliated with, endorsed by, sponsored by, or officially connected to SpacetimeDB or Clockwork Labs. Any references to SpacetimeDB are used only to describe the technology this demo is built with.

No Legal, Security, or Production Guarantees

This codebase is shared "AS IS" for learning and experimentation. It may contain bugs, security issues, or breaking changes and is not guaranteed to be suitable for production use.

Assumption of Risk

By using, forking, deploying, or modifying this project, you acknowledge that you do so at your own risk. You are solely responsible for any outcomes, including data loss, downtime, security incidents, legal obligations, or other damages.

Limitation of Liability

To the maximum extent permitted by law, the authors and contributors are not liable for any claim, loss, or damages (direct, indirect, incidental, special, exemplary, or consequential) arising from or related to the use of this project.`;

export default function DisclaimerPage() {
  const navigate = useNavigate();

  return (
    <div className="disclaimer-page">
      <div className="disclaimer-page__container">
        <header className="disclaimer-page__header">
          <h1 className="disclaimer-page__title">Disclaimer</h1>
          <p className="disclaimer-page__subtitle">SpacetimeDB Auth Demo</p>
          <button
            type="button"
            className="disclaimer-page__back"
            onClick={() => navigate('/')}
          >
            ← Back to App
          </button>
        </header>
        <pre className="disclaimer-page__content">{DISCLAIMER_TEXT}</pre>
      </div>
    </div>
  );
}
