/**
 * HPE ChatHPE API Client — with automatic OpenAI / Azure OpenAI fallback.
 *
 * Priority:
 *   1. HPE ChatHPE  (requires VPN: AUTHENTICATION_TOKEN + CLIENT_ID)
 *   2. Azure OpenAI (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT)
 *   3. OpenAI       (OPENAI_API_KEY)
 *
 * If HPE is unreachable (ENOTFOUND / ECONNREFUSED / timeout) the client
 * transparently retries the same prompt via whichever fallback is configured.
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import dotenv from 'dotenv';
import OpenAI, { AzureOpenAI } from 'openai';
import { getModel } from '../models/registry';

dotenv.config();

// ─── OpenAI / Azure fallback helper ───────────────────────────────────────────

function isNetworkError(err: any): boolean {
  const code: string = err?.code || '';
  const msg:  string = (err?.message || '').toLowerCase();
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    msg.includes('getaddrinfo') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('enotfound')
  );
}

function hasFallbackConfig(): boolean {
  const hasOpenAI = !!(process.env.OPENAI_API_KEY || '').trim();
  const hasAzure = !!(
    (process.env.AZURE_OPENAI_API_KEY || '').trim() &&
    (process.env.AZURE_OPENAI_ENDPOINT || '').trim() &&
    (process.env.AZURE_OPENAI_DEPLOYMENT || process.env.LLM_MODEL_NAME || '').trim()
  );
  return hasOpenAI || hasAzure;
}

function isQuotaExceededError(status: number, bodyStr: string): boolean {
  if (status !== 403) return false;
  return /exceeded.*token limit|token quota|quota is|quota.*used/i.test(bodyStr || '');
}

async function askOpenAIFallback(prompt: string): Promise<string> {
  const azureKey        = (process.env.AZURE_OPENAI_API_KEY   || '').trim();
  const azureEndpoint   = (process.env.AZURE_OPENAI_ENDPOINT  || '').trim();
  const azureDeployment = (process.env.AZURE_OPENAI_DEPLOYMENT || process.env.LLM_MODEL_NAME || 'gpt-4o-mini').trim();
  const openaiKey       = (process.env.OPENAI_API_KEY         || '').trim();
  const openaiModel     = (process.env.OPENAI_MODEL           || process.env.LLM_MODEL_NAME || 'gpt-4o-mini').trim();
  const maxTokens       = parseInt(process.env.LLM_MAX_TOKENS || '2000');

  // Prefer Azure OpenAI if fully configured
  if (azureKey && azureEndpoint && azureDeployment) {
    console.log('[LLM Fallback] Using Azure OpenAI →', azureEndpoint);
    const client = new AzureOpenAI({
      apiKey: azureKey,
      endpoint: azureEndpoint,
      deployment: azureDeployment,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview',
    });
    const resp = await client.chat.completions.create({
      model: azureDeployment,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    });
    return resp.choices[0]?.message?.content || '';
  }

  // Fall back to standard OpenAI
  if (openaiKey) {
    console.log('[LLM Fallback] Using OpenAI →', openaiModel);
    const client = new OpenAI({ apiKey: openaiKey });
    const resp = await client.chat.completions.create({
      model: openaiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    });
    return resp.choices[0]?.message?.content || '';
  }

  throw new Error(
    'HPE API unreachable (not on VPN?) and no fallback configured.\n' +
    'Add one of the following to mcp-client/.env:\n' +
    '  • OPENAI_API_KEY=sk-...\n' +
    '  • AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT\n' +
    'Also verify HPE endpoint via HPE_API_ENDPOINT (default: https://api.chathpe.it.hpe.com/v2.8).'
  );
}

export class HPEClient {
  private http: AxiosInstance;
  private userId   = '';
  private username = '';
  private sessionId = '';
  private ready    = false;
  private model    : string;
  private endpoint : string;

  constructor() {
    // Keep HPE endpoint separate from Azure OpenAI endpoint to avoid accidental misrouting.
    this.endpoint = (
      process.env.HPE_API_ENDPOINT ||
      process.env.HPE_ENDPOINT ||
      'https://api.chathpe.it.hpe.com/v2.8'
    )
      .replace(/\/$/, '');
    this.model = process.env.LLM_MODEL_NAME || 'gpt-4o-mini';

    const token    = (process.env.AUTHENTICATION_TOKEN || '').trim();
    const clientId = (process.env.CLIENT_ID || '').trim();

    // Build HTTPS agent
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const bearerToken = token.toLowerCase().startsWith('bearer ')
      ? token
      : `Bearer ${token}`;

    this.http = axios.create({
      baseURL : this.endpoint + '/',
      httpsAgent,
      timeout : 120_000,
      headers : {
        'Authorization': bearerToken,
        'Client-ID'    : clientId,
        'Content-Type' : 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!token)    console.warn('⚠  HPE: AUTHENTICATION_TOKEN not set in mcp-client/.env');
    if (!clientId) console.warn('⚠  HPE: CLIENT_ID not set in mcp-client/.env — copy from Transcripts_final/Transcripts/.env');

    // ── Skip login if session is already pre-populated in .env ──────────
    // The Python app writes sessionId + USER_ID after its own login; reuse them.
    const envSession  = (process.env.sessionId || process.env.SESSION_ID || '').trim();
    const envUserId   = (process.env.USER_ID   || '').trim();
    const envUsername = (process.env.USER_NAME || '').trim();
    if (envSession && envUserId) {
      this.sessionId = envSession;
      this.userId    = envUserId;
      // Prefer explicit USER_NAME from .env (display name the server expects),
      // fall back to email extracted from the JWT.
      this.username  = envUsername || this._usernameFromJwt(token);
      this.ready     = true;
      console.log(`✓ HPE: Using pre-populated session (${this.sessionId.substring(0, 8)}…) as ${this.username}`);
    } else {
      console.log('✓ HPE: Will login on first request');
    }
  }

  /**
   * Hot-swap the Bearer token without restarting the server.
   * POST /api/auth/token  { token: "eyJ..." }
   */
  updateToken(newToken: string): void {
    const bearer = newToken.trim().toLowerCase().startsWith('bearer ')
      ? newToken.trim()
      : `Bearer ${newToken.trim()}`;
    // Update the Authorization header on the shared axios instance.
    this.http.defaults.headers.common['Authorization'] = bearer;
    // Restore pre-populated session so we skip re-login.
    const envSession  = (process.env.sessionId || process.env.SESSION_ID || '').trim();
    const envUserId   = (process.env.USER_ID   || '').trim();
    const envUsername = (process.env.USER_NAME || '').trim();
    if (envSession && envUserId) {
      this.sessionId = envSession;
      this.userId    = envUserId;
      this.username  = envUsername || this._usernameFromJwt(newToken.trim());
      this.ready     = true;
    } else {
      // Force fresh login with the new token.
      this.resetSession();
    }
    console.log('✓ HPE: Bearer token hot-swapped');
  }

  /** Extract preferred_username/email from the JWT payload (no external dep). */
  private _usernameFromJwt(token: string): string {
    try {
      const payload = token.split('.')[1];
      if (!payload) return '';
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      return decoded.preferred_username || decoded.email || decoded.sub || '';
    } catch {
      return '';
    }
  }

  // ── Internal: login + preferences + sessionId ──────────────────────

  private async login(): Promise<void> {
    console.log('[HPE] Logging in ...');

    // 1. Login
    const loginRes = await this.http.post('login', { appId: '1' });
    const bot = loginRes.data?.chatHPE_bot_data || {};
    this.userId   = bot.userId   || '';
    this.username = bot.username || '';
    console.log(`[HPE] Logged in as ${this.username}`);

    // 2. Set preferences
    await this.http.post('preferences', {
      agreement : true,
      dark_mode : true,
      stream    : false,
      webScraping: false,
      chatHPE_bot_data: {
        appId    : '1',
        sessionId: '-1',
        userId   : this.userId,
        username : this.username,
      },
    });

    // 3. Get session ID
    const sessRes = await this.http.get('sessionId_generator', { responseType: 'text' });
    const raw = String(sessRes.data);
    // Python does: str(raw.split()[2])[2:-2]  (strips b'...' from bytes repr)
    // In Node we just extract the UUID directly
    const uuidMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    this.sessionId = uuidMatch ? uuidMatch[0] : raw.trim().split(/\s+/).pop() || '';
    this.ready = true;
    console.log(`[HPE] Session ready (${this.sessionId.substring(0, 8)}...)`);
  }

  // ── Public: send a prompt, get back the response text ──────────────

  async ask(prompt: string, modelOverride?: string): Promise<string> {
    if (!this.ready) {
      await this.login();
    }

    const modelId = (modelOverride || this.model).trim();
    const modelDef = getModel(modelId);
    console.log(`[HPE] Using model: ${modelDef.label} | session: ${this.sessionId.substring(0,8)}… | user: ${this.username}`);

    const res = await this.http.post(
      'call/chatlite?force_async=false&session_management_support=true&internal_call=false&proxy=false',
      {
        chatHPE_bot_data: {
          appId    : '1',
          sessionId: this.sessionId,
          userId   : this.userId,
          username : this.username,
        },
        model_name  : modelId,
        stream      : false,
        webScraping : false,
        user_query  : prompt,
      }
    );

    return res.data?.Response || '';
  }

  // Call ask() with smart retry + fallback logic
  async askWithRetry(prompt: string, modelOverride?: string): Promise<string> {
    try {
      return await this.ask(prompt, modelOverride);
    } catch (err: any) {
      // ── 1. Network-level failure (VPN off, DNS error, timeout) ──────────
      if (isNetworkError(err)) {
        console.warn('[HPE] Network unreachable:', err.code || err.message);
        console.warn('[HPE] Switching to OpenAI/Azure fallback…');
        return await askOpenAIFallback(prompt);
      }

      const status: number = err?.response?.status ?? 0;
      const bodyStr: string = err?.response?.data ? JSON.stringify(err.response.data) : '';

      // ── 2. HPE quota exceeded — do not misreport as VPN/network issue ─────
      if (isQuotaExceededError(status, bodyStr)) {
        console.warn('[HPE] Quota exceeded detected from API response.');
        if (hasFallbackConfig()) {
          console.warn('[HPE] Switching to OpenAI/Azure fallback due to quota exhaustion…');
          return await askOpenAIFallback(prompt);
        }
        throw new Error(
          'HPE quota exceeded for this user token. ' +
          'Please wait for quota reset or configure fallback in mcp-client/.env:\n' +
          '  • OPENAI_API_KEY=sk-...\n' +
          '  • AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT\n' +
          `HPE detail: ${bodyStr.substring(0, 260)}`
        );
      }

      // ── 3. Rate-limit (429) — wait then retry once, else fallback ───────
      if (status === 429) {
        const retryAfter = parseInt(err?.response?.headers?.['retry-after'] || '5', 10);
        const waitSec = isNaN(retryAfter) || retryAfter > 60 ? 5 : retryAfter;
        console.warn(`[HPE] Rate-limited (429). Waiting ${waitSec}s before retry…`);
        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
        try {
          return await this.ask(prompt, modelOverride);
        } catch (retryErr: any) {
          const retryStatus: number = retryErr?.response?.status ?? 0;
          if (retryStatus === 429 || isNetworkError(retryErr)) {
            console.warn('[HPE] Still rate-limited/unreachable after retry — switching to fallback…');
            return await askOpenAIFallback(prompt);
          }
          throw retryErr;
        }
      }

      // ── 4. Auth/session failure: re-login once, then fallback ───────────
      const isSessionError = (
        status === 401 || status === 403 || status === 422 || status === 400 ||
        /session|expired|invalid.*(token|session)|unauthorized/i.test(bodyStr)
      );
      if (isSessionError) {
        console.warn(`[HPE] Auth/session error (${status}) — clearing session and attempting re-login…`);
        if (bodyStr) console.warn('[HPE] Response body:', bodyStr.substring(0, 300));
        this.resetSession();
        try {
          return await this.ask(prompt, modelOverride);
        } catch (retryErr: any) {
          const retryStatus: number = retryErr?.response?.status ?? 0;
          const retryBody = retryErr?.response?.data ? JSON.stringify(retryErr.response.data).substring(0, 300) : '';
          if (isQuotaExceededError(retryStatus, retryBody)) {
            if (hasFallbackConfig()) return await askOpenAIFallback(prompt);
            throw new Error(`HPE quota exceeded after session retry. Detail: ${retryBody}`);
          }
          if (retryStatus === 429 || isNetworkError(retryErr)) {
            return await askOpenAIFallback(prompt);
          }
          if (retryStatus === 401 || retryStatus === 403 || retryStatus === 422 || retryStatus === 400) {
            console.warn(`[HPE] Still failing (${retryStatus}) after re-login. Detail: ${retryBody}`);
            return await askOpenAIFallback(prompt);
          }
          throw retryErr;
        }
      }

      // ── 5. Any 5xx server error — try fallback directly ─────────────────
      if (status >= 500) {
        console.warn(`[HPE] Server error (${status}) — switching to fallback…`);
        return await askOpenAIFallback(prompt);
      }

      // ── 6. Unknown error — log detail and propagate ─────────────────────
      const unknownBody = err?.response?.data ? JSON.stringify(err.response.data).substring(0, 400) : '';
      console.error(`[HPE] Unhandled error (status=${status}, code=${err?.code}): ${err?.message}`);
      if (unknownBody) console.error('[HPE] Response body:', unknownBody);
      throw err;
    }
  }

  /** Probe the HPE API with a minimal request — returns diagnostic object */
  async diagnose(): Promise<{ ok: boolean; status?: number; error?: string; body?: string; tokenExpiresIn?: number }> {
    try {
      const token = ((this.http.defaults.headers?.common?.['Authorization'] as string) || '')
        .replace(/^Bearer /i, '').trim();
      let tokenExpiresIn: number | undefined;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        tokenExpiresIn = Math.round(payload.exp - Date.now() / 1000);
      } catch (_) {}

      await this.ask('ping', undefined);
      return { ok: true, tokenExpiresIn };
    } catch (err: any) {
      const status: number = err?.response?.status ?? 0;
      const body: string = err?.response?.data ? JSON.stringify(err.response.data).substring(0, 400) : '';
      const token = ((this.http.defaults.headers?.common?.['Authorization'] as string) || '')
        .replace(/^Bearer /i, '').trim();
      let tokenExpiresIn: number | undefined;
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        tokenExpiresIn = Math.round(payload.exp - Date.now() / 1000);
      } catch (_) {}
      return { ok: false, status, error: err.message, body, tokenExpiresIn };
    }
  }

  resetSession(): void {
    this.ready     = false;
    this.userId    = '';
    this.username  = '';
    this.sessionId = '';
  }
}

// Singleton — shared across LLM handler and agent handler
let _instance: HPEClient | null = null;
export function getHPEClient(): HPEClient {
  if (!_instance) _instance = new HPEClient();
  return _instance;
}
