import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAuthenticate,
  emailFeaturesEnabled,
  requiresEmailProvider,
  resolveEmailMode,
} from '../email-mode.js';

test('email mode has environment-appropriate secure defaults', () => {
  assert.equal(resolveEmailMode(undefined, true), 'console');
  assert.equal(resolveEmailMode(undefined, false), 'resend');
});

test('disabled mode is an explicit production-safe no-email option', () => {
  assert.equal(resolveEmailMode('disabled', false), 'disabled');
  assert.equal(emailFeaturesEnabled('disabled'), false);
  assert.equal(requiresEmailProvider('disabled'), false);
  assert.equal(canAuthenticate('disabled', false), true);
});

test('email-enabled modes require verification before authentication', () => {
  assert.equal(canAuthenticate('console', false), false);
  assert.equal(canAuthenticate('resend', false), false);
  assert.equal(canAuthenticate('console', true), true);
  assert.equal(canAuthenticate('resend', true), true);
});

test('console delivery is rejected in production', () => {
  assert.throws(
    () => resolveEmailMode('console', false),
    /restricted to development/,
  );
});

test('unknown email modes fail closed', () => {
  assert.throws(
    () => resolveEmailMode('smtp', true),
    /must be one of/,
  );
});
