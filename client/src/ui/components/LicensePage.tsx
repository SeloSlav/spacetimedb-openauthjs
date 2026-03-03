/**
 * LicensePage.tsx
 * Displays the full MIT license text in a readable format.
 */

import { useNavigate } from 'react-router-dom';
import './LicensePage.css';

const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2025 SpacetimeDB Auth Demo Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export default function LicensePage() {
  const navigate = useNavigate();

  return (
    <div className="license-page">
      <div className="license-page__container">
        <header className="license-page__header">
          <h1 className="license-page__title">MIT License</h1>
          <p className="license-page__subtitle">SpacetimeDB Auth Demo</p>
          <button
            type="button"
            className="license-page__back"
            onClick={() => navigate('/')}
          >
            ← Back to App
          </button>
        </header>
        <pre className="license-page__content">{MIT_LICENSE_TEXT}</pre>
      </div>
    </div>
  );
}
