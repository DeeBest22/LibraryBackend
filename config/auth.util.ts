// src/config/auth.util.ts
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { env } from './env.js';

// --------------------------------------------------------------------------
// State / nonce / PKCE generation
// --------------------------------------------------------------------------
export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateNonce(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString('base64url');
}

export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
}

// --------------------------------------------------------------------------
// OIDC discovery — replaces hardcoded /authorize, /token, /logout paths.
// These paths differ per provider (e.g. Auth0 uses /oauth/token, not /token,
// which is what caused the last error) — discovery reads the real ones.
// --------------------------------------------------------------------------
interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
   issuer: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

let discoveryCache: OidcDiscovery | null = null;
let discoveryFetchedAt = 0;
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getOidcDiscovery(): Promise<OidcDiscovery> {
  const now = Date.now();
  if (discoveryCache && now - discoveryFetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const url = `${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch OIDC discovery document from ${url}: ${res.status}`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache = doc;
  discoveryFetchedAt = now;
  return doc;
}

export async function getTokenEndpoint(): Promise<string> {
  const discovery = await getOidcDiscovery();
  return discovery.token_endpoint;
}

// --------------------------------------------------------------------------
// Errors
// --------------------------------------------------------------------------
export class IDTokenValidationError extends Error {
  errorType: string;
  constructor(message: string, errorType = 'validation_error') {
    super(message);
    this.name = 'IDTokenValidationError';
    this.errorType = errorType;
  }
}

export class AccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessTokenError';
  }
}

// --------------------------------------------------------------------------
// App-issued JWT access tokens (HS256)
// --------------------------------------------------------------------------
function userHashFor(sub: unknown): string {
  if (sub === undefined || sub === null || sub === 'unknown') return 'unknown';
  return crypto.createHash('sha256').update(String(sub)).digest('hex').slice(0, 8);
}

export function createAccessToken(claims: Record<string, unknown>, expiresMinutes?: number): string {
  if (!env.JWT_SECRET_KEY) {
    console.error('JWT secret key is not configured');
    throw new Error('JWT secret key is not configured');
  }

  const expiryMinutes = expiresMinutes ?? env.JWT_EXPIRE_MINUTES;
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenClaims = { ...claims, exp: nowSec + expiryMinutes * 60, iat: nowSec, nbf: nowSec };

  const token = jwt.sign(tokenClaims, env.JWT_SECRET_KEY, {
    algorithm: env.JWT_ALGORITHM as jwt.Algorithm,
  });

  console.debug(`Authentication token created for user hash: ${userHashFor(claims.sub)}`);
  return token;
}

export function decodeAccessToken(token: string): jwt.JwtPayload {
  if (!env.JWT_SECRET_KEY) {
    console.error('JWT secret key is not configured');
    throw new AccessTokenError('Authentication service is misconfigured');
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET_KEY, {
      algorithms: [env.JWT_ALGORITHM as jwt.Algorithm],
    }) as jwt.JwtPayload;
    console.debug(`Authentication token validated for user hash: ${userHashFor(payload.sub)}`);
    return payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      console.info('Authentication token has expired');
      throw new AccessTokenError('Token has expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      console.warn(`Token validation failed: ${err.name}`);
      throw new AccessTokenError('Invalid authentication token');
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// OIDC ID token validation (RS256 via JWKS)
// --------------------------------------------------------------------------
const jwks = jwksClient({
  jwksUri: `${env.OIDC_ISSUER_URL}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(kid, (err, key) => {
      if (err || !key) {
        reject(err ?? new Error('Signing key not found'));
        return;
      }
      resolve(key.getPublicKey());
    });
  });
}

export async function validateIdToken(
  idToken: string,
): Promise<jwt.JwtPayload & { sub: string; nonce?: string; email?: string; name?: string }> {
  const decoded = jwt.decode(idToken, { complete: true }) as { header: { kid?: string } } | null;
  const kid = decoded?.header?.kid;

  if (!kid) {
    console.error('ID token validation failed: No key ID found in JWT header');
    throw new IDTokenValidationError('Token format is invalid', 'missing_kid');
  }

  let publicKey: string;
  try {
    publicKey = await getSigningKey(kid);
  } catch (e) {
    console.error(
      `ID token validation failed: could not resolve signing key ${kid} from ${env.OIDC_ISSUER_URL}: ${(e as Error).message}`,
    );
    throw new IDTokenValidationError('Authentication key validation failed', 'key_not_found');
  }
 const discovery = await getOidcDiscovery();
  try {
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      issuer: discovery.issuer,
      
      audience: env.OIDC_CLIENT_ID,
    }) as jwt.JwtPayload;

    console.info(`ID token successfully validated for user hash: ${userHashFor(payload.sub)}`);
    return payload as jwt.JwtPayload & { sub: string; nonce?: string; email?: string; name?: string };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      console.error('JWT validation failed: ID token has expired');
      throw new IDTokenValidationError('Token has expired', 'token_expired');
    }
    if (e instanceof jwt.NotBeforeError) {
      console.error('JWT validation failed: token used before nbf');
      throw new IDTokenValidationError('Token claims validation failed', 'invalid_claims');
    }
    if (e instanceof jwt.JsonWebTokenError) {
      const msg = e.message.toLowerCase();
      if (msg.includes('signature')) {
        console.error('JWT validation failed: Invalid JWT signature');
        throw new IDTokenValidationError('Token signature verification failed', 'invalid_signature');
      }
      if (msg.includes('issuer')) {
        console.error(`JWT validation failed: Claims validation error: ${e.message}`);
        throw new IDTokenValidationError('Token issuer validation failed', 'invalid_issuer');
      }
      if (msg.includes('audience')) {
        console.error(`JWT validation failed: Claims validation error: ${e.message}`);
        throw new IDTokenValidationError('Token audience validation failed', 'invalid_audience');
      }
      console.error(`JWT validation failed: ${e.message}`);
      throw new IDTokenValidationError('Token claims validation failed', 'invalid_claims');
    }
    console.error(`Unexpected error during ID token validation: ${(e as Error).message}`);
    throw new IDTokenValidationError('Authentication processing failed', 'unexpected_error');
  }
}

// --------------------------------------------------------------------------
// Authorization / logout URL builders — now async, using discovery
// --------------------------------------------------------------------------
export async function buildAuthorizationUrl(
  state: string,
  nonce: string,
  codeChallenge?: string,
  redirectUri?: string,
): Promise<string> {
  const discovery = await getOidcDiscovery();
  const params = new URLSearchParams({
    client_id: env.OIDC_CLIENT_ID,
    response_type: 'code',
    scope: env.OIDC_SCOPE,
    redirect_uri: redirectUri ?? `${env.BACKEND_URL}/api/v1/auth/callback`,
    state,
    nonce,
  });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

export async function buildLogoutUrl(idToken?: string): Promise<string> {
  let endSessionEndpoint: string;
  try {
    const discovery = await getOidcDiscovery();
    endSessionEndpoint = discovery.end_session_endpoint ?? `${env.OIDC_ISSUER_URL}/v2/logout`;
  } catch {
    endSessionEndpoint = `${env.OIDC_ISSUER_URL}/v2/logout`;
  }

  const params = new URLSearchParams({
    post_logout_redirect_uri: `${env.FRONTEND_URL}/logout-callback`,
  });
  if (idToken) params.set('id_token_hint', idToken);
  params.set('client_id', env.OIDC_CLIENT_ID);
  return `${endSessionEndpoint}?${params.toString()}`;
}