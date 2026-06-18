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

function resolveOpenAIFallbackModel(modelOverride?: string): string {
  const requested = (modelOverride || '').trim();
  const configured = (process.env.OPENAI_MODEL || process.env.LLM_MODEL_NAME || 'gpt-4o-mini').trim();

  // OpenAI fallback can only use OpenAI-compatible model ids.
  // If user selected a non-OpenAI model (e.g. Claude/Mistral/Grok on HPE),
  // fall back to the configured OpenAI model.
  if (!requested) return configured;
  if (/^gpt-|^o[1-9]/i.test(requested)) return requested;

  console.warn(`[LLM Fallback] Model '${requested}' is not OpenAI-compatible; using '${configured}' instead.`);
  return configured;
}

async function askOpenAIFallback(prompt: string, modelOverride?: string): Promise<string> {
  const azureKey        = (process.env.AZURE_OPENAI_API_KEY   || '').trim();
  const azureEndpoint   = (process.env.AZURE_OPENAI_ENDPOINT  || '').trim();
  const azureDeployment = (process.env.AZURE_OPENAI_DEPLOYMENT || process.env.LLM_MODEL_NAME || 'gpt-4o-mini').trim();
  const openaiKey       = (process.env.OPENAI_API_KEY         || '').trim();
  const openaiModel     = resolveOpenAIFallbackModel(modelOverride);
  const maxTokens       = parseInt(process.env.LLM_MAX_TOKENS || '2000');

  // Prefer Azure OpenAI if fully configured
  if (azureKey && azureEndpoint && azureDeployment) {
    console.log('[LLM Fallback] Using Azure OpenAI →', azureEndpoint, '| deployment:', azureDeployment);
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
    'Add one of the following to mcp-server/.env:\n' +
    '  • OPENAI_API_KEY=sk-...\n' +
    '  • AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT'
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
    this.endpoint = (process.env.AZURE_OPENAI_ENDPOINT || 'https://api.chathpe.it.hpe.com/v2.8')
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

    if (!token)    console.warn('⚠  HPE: AUTHENTICATION_TOKEN not set in mcp-server/.env');
    if (!clientId) console.warn('⚠  HPE: CLIENT_ID not set in mcp-server/.env — copy from Transcripts_final/Transcripts/.env');

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
        return await askOpenAIFallback(prompt, modelOverride);
      }

      const status: number = err?.response?.status ?? 0;

      // ── 2. Auth failure: re-login once, then fallback if still failing ──
      if (status === 401 || status === 403 || status === 422) {
        console.warn(`[HPE] Auth/session error (${status}) — clearing session and attempting re-login…`);
        this.resetSession();
        try {
          return await this.ask(prompt, modelOverride);
        } catch (retryErr: any) {
          if (isNetworkError(retryErr)) {
            console.warn('[HPE] Network unreachable on retry, switching to fallback…');
            return await askOpenAIFallback(prompt, modelOverride);
          }
          const retryStatus: number = retryErr?.response?.status ?? 0;
          if (retryStatus === 401 || retryStatus === 403 || retryStatus === 422) {
            const body422 = retryErr?.response?.data ? JSON.stringify(retryErr.response.data).substring(0,200) : '';
            console.warn(`[HPE] Still failing (${retryStatus}) after re-login. Detail: ${body422}`);
            console.warn('[HPE] Possible causes: token expired, model not available on account, or invalid session.');
            console.warn('[HPE] Switching to OpenAI/Azure fallback…');
            return await askOpenAIFallback(prompt, modelOverride);
          }
          throw retryErr;
        }
      }

      throw err;
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
