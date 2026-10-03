const apiOrigin = process.env.API_ORIGIN;
if (!apiOrigin) throw new Error('Set API_ORIGIN to the deployed API project HTTPS origin.');
const url = new URL(apiOrigin);
if (url.protocol !== 'https:' || url.origin !== apiOrigin)
  throw new Error('API_ORIGIN must be an exact HTTPS origin.');

export const config = {
  framework: 'vite',
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
  rewrites: [
    { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
