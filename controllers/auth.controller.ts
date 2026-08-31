// src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import {
  generateState,
  generateNonce,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  buildLogoutUrl,
  validateIdToken,
  IDTokenValidationError,
} from '../config/auth.util.ts';
import { env } from '../config/env.ts';
import { getOrCreateUser, issueAppToken, storeOidcState, getAndDeleteOidcState } from '../services/auth.service.ts';
import { AppError } from '../middleware/error-handler.ts';

type Response2 = globalThis.Response;

function localPatch(url: string): string {
  if (!['true', '1'].includes((process.env.LOCAL_PATCH ?? '').toLowerCase())) return url;
  return url.replace('https://', 'http://').replace(':8000', ':3000');
}

function getDynamicBackendUrl(req: Request): string {
  const mgxExternalDomain = req.headers['mgx-external-domain'] as string | undefined;
  const xForwardedHost = req.headers['x-forwarded-host'] as string | undefined;
  const host = req.headers['host'];
  const scheme = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';

  const effectiveHost = mgxExternalDomain || xForwardedHost || host;
  if (!effectiveHost) return env.BACKEND_URL;

  return localPatch(`${scheme}://${effectiveHost}`);
}

function deriveNameFromEmail(email: string): string {
  return email ? email.split('@', 1)[0] : '';
}

export async function login(req: Request, res: Response): Promise<void> {
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await storeOidcState(state, nonce, codeVerifier);

  const backendUrl = getDynamicBackendUrl(req);
  const redirectUri = `${backendUrl}/api/v1/auth/callback`;

  const authUrl = buildAuthorizationUrl(state, nonce, codeChallenge, redirectUri);
  res.setHeader('X-Request-ID', state);
  res.redirect(302, authUrl);
}

export async function callback(req: Request, res: Response): Promise<void> {
  const backendUrl = getDynamicBackendUrl(req);
  const { code, state, error } = req.query as Record<string, string | undefined>;

  const redirectWithError = (message: string) => {
    const fragment = new URLSearchParams({ msg: message }).toString();
    res.redirect(302, `${backendUrl}/auth/error?${fragment}`);
  };

  if (error) return redirectWithError(`OIDC error: ${error}`);
  if (!code || !state) return redirectWithError('Missing code or state parameter');

  const tempData = await getAndDeleteOidcState(state);
  if (!tempData) return redirectWithError('Invalid or expired state parameter');

  const { nonce, codeVerifier } = tempData;

  try {
    const redirectUri = `${backendUrl}/api/v1/auth/callback`;

    const tokenData: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
    };
    if (codeVerifier) tokenData.code_verifier = codeVerifier;

    const tokenUrl = `${env.OIDC_ISSUER_URL}/token`;
    let tokenResponse: Response2;
    try {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Request-ID': state },
        body: new URLSearchParams(tokenData),
      });
    } catch (e) {
      return redirectWithError(`Token exchange failed: ${(e as Error).message}`);
    }

    if (tokenResponse.status !== 200) {
      const text = await tokenResponse.text();
      return redirectWithError(`Token exchange failed: ${text}`);
    }

    const tokens = await tokenResponse.json();
    const idToken = tokens.id_token;
    if (!idToken) return redirectWithError('No ID token received');

    const idClaims = await validateIdToken(idToken);

    if (idClaims.nonce !== nonce) return redirectWithError('Invalid nonce');

    const email = idClaims.email ?? '';
    const name = idClaims.name || deriveNameFromEmail(email);
    const user = await getOrCreateUser(idClaims.sub, email, name);

    const { token: appToken, expiresAt } = await issueAppToken(user);

    const fragment = new URLSearchParams({
      token: appToken,
      expires_at: String(Math.floor(expiresAt.getTime() / 1000)),
      token_type: 'Bearer',
    }).toString();

    res.redirect(302, `${backendUrl}/auth/callback?${fragment}`);
  } catch (e) {
    if (e instanceof IDTokenValidationError) {
      return redirectWithError(`Authentication failed: ${e.message}`);
    }
    console.error('Unexpected error in OIDC callback:', e);
    return redirectWithError('Authentication processing failed. Please try again or contact support if the issue persists.');
  }
}

export async function exchangePlatformToken(req: Request, res: Response): Promise<void> {
  const { platform_token: platformToken } = req.validated!.body as { platform_token: string };

  const verifyUrl = `${env.OIDC_ISSUER_URL}/platform/tokens/verify`;
  let verifyResponse: Response2;
  try {
    verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_token: platformToken }),
    });
  } catch {
    throw new AppError(502, 'BAD_GATEWAY', 'Unable to verify platform token');
  }

  let verifyBody: unknown;
  try {
    verifyBody = await verifyResponse.json();
  } catch {
    throw new AppError(502, 'BAD_GATEWAY', 'Invalid response from platform token verification service');
  }

  if (typeof verifyBody !== 'object' || verifyBody === null) {
    throw new AppError(502, 'BAD_GATEWAY', 'Unexpected response from platform token verification service');
  }

  const body = verifyBody as { success?: boolean; message?: string; data?: Record<string, unknown> };
  if (verifyResponse.status !== 200 || !body.success) {
    throw new AppError(verifyResponse.status || 502, 'PLATFORM_VERIFY_FAILED', body.message || 'Platform token verification failed');
  }

  const payloadData = body.data ?? {};
  const rawUserId = payloadData.user_id;
  if (!rawUserId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Platform token payload missing user_id');
  }

  const platformUserId = String(rawUserId);
  const isAdmin = platformUserId === String(env.ADMIN_USER_ID);
  const role = isAdmin ? 'admin' : 'user';

  const userEmail = (payloadData.email as string) || (isAdmin ? env.ADMIN_USER_EMAIL ?? '' : '');
  const userName = (payloadData.name as string) || (payloadData.username as string) || deriveNameFromEmail(userEmail);

  const { token: appToken } = await issueAppToken({
    id: platformUserId,
    email: userEmail,
    name: userName,
    role,
  });

  res.status(200).json({ token: appToken });
}

export async function getCurrentUserInfo(req: Request, res: Response): Promise<void> {
  res.status(200).json(req.user);
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ redirect_url: buildLogoutUrl() });
}