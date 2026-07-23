/**
 * Basic JWT parsing utility.
 * Note: This does NOT verify the token signature. Verification should happen server-side
 * or using a more robust library if needed client-side (though generally discouraged).
 */

export interface JwtPayload {
  exp?: number;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  userId?: string;
  email?: string;
  email_verified?: boolean;
  token_use?: string;
  [claim: string]: unknown;
}

export function parseJwt(token: string): JwtPayload {
    try {
      const base64Url = token.split('.')[1]; // Get the payload part
      if (!base64Url) {
          throw new Error('Invalid JWT token structure');
      }
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
      );

      const payload: unknown = JSON.parse(jsonPayload);
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error('Invalid JWT payload');
      }
      return payload as JwtPayload;
    } catch (error) {
        console.error("Error decoding JWT:", error);
        throw new Error('Could not parse JWT token');
    }
  }
