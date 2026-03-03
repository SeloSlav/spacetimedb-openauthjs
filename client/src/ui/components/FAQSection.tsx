/**
 * FAQSection - FAQ accordion for the login/landing page.
 * Uses theme CSS from client/src/theme.
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { uiTheme } from '../../theme/uiTheme.ts';

export interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

interface FAQSectionProps {
  items: FAQItem[];
  expandedIndex: number | null;
  onToggle: (index: number) => void;
}

const FAQSection: React.FC<FAQSectionProps> = ({ items, expandedIndex, onToggle }) => (
  <div
    data-faq-section
    className={`${uiTheme.contentCard} stdb-faq-section`}
  >
    <div className={`${uiTheme.sectionLabel} stdb-section-label-spaced`} style={{ textAlign: 'center' }}>
      FAQ
    </div>

    <p className="stdb-faq-intro">
      We're here to help. Below you'll find answers to common questions about this demo. If you have more questions, check out the{' '}
      <a
        href="/README.md"
        target="_blank"
        rel="noopener noreferrer"
        className="stdb-link"
      >
        README
      </a>
      .
    </p>

    <div className="stdb-faq-list">
      {items.map((faq, index) => {
        const isExpanded = expandedIndex === index;
        return (
          <div key={index} className="stdb-faq-item" data-expanded={isExpanded}>
            <button
              type="button"
              onClick={() => onToggle(index)}
              className="stdb-faq-trigger"
              data-expanded={isExpanded}
            >
              <h3 className="stdb-faq-question">{faq.question}</h3>
              <FontAwesomeIcon icon={faChevronDown} className="stdb-faq-chevron" />
            </button>
            {isExpanded && (
              <div className="stdb-faq-answer">
                {faq.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export default FAQSection;
