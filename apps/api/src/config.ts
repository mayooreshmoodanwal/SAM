const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigin = process.env.APP_ORIGIN || (isProduction ? '' : 'http://localhost:5173');

if (!configuredOrigin) throw new Error('APP_ORIGIN is required in production.');
const originUrl = new URL(configuredOrigin);
if (configuredOrigin !== originUrl.origin)
  throw new Error('APP_ORIGIN must be an exact origin without a path or trailing slash.');

const localOrigin =
  originUrl.protocol === 'http:' &&
  (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1');
if (isProduction && originUrl.protocol !== 'https:' && !localOrigin)
  throw new Error('Production APP_ORIGIN must use HTTPS, except on localhost.');

export const appOrigin = originUrl.origin;
export const secureCookie = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : originUrl.protocol === 'https:';
if (isProduction && !secureCookie && !localOrigin)
  throw new Error('Secure cookies are required for a public production origin.');
