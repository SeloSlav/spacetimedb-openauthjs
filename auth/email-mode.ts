export const EMAIL_MODES = ['resend', 'console', 'disabled'] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

export function resolveEmailMode(rawMode: string | undefined, isDevelopment: boolean): EmailMode {
  const mode = rawMode?.trim().toLowerCase() || (isDevelopment ? 'console' : 'resend');

  if (!EMAIL_MODES.includes(mode as EmailMode)) {
    throw new Error(`AUTH_EMAIL_MODE must be one of: ${EMAIL_MODES.join(', ')}`);
  }
  if (!isDevelopment && mode === 'console') {
    throw new Error('AUTH_EMAIL_MODE=console is restricted to development because email links are bearer credentials.');
  }

  return mode as EmailMode;
}

export function requiresEmailProvider(mode: EmailMode): boolean {
  return mode === 'resend';
}

export function emailFeaturesEnabled(mode: EmailMode): boolean {
  return mode !== 'disabled';
}

export function canAuthenticate(mode: EmailMode, emailVerified: boolean): boolean {
  return mode === 'disabled' || emailVerified;
}
