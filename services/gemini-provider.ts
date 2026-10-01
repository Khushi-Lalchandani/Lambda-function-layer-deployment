import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { CredentialBody } from 'google-auth-library';
import {
  createRequestId,
  extractErrorCode,
  extractErrorMessage,
  extractUsageFromResponse,
  GEMINI_PROVIDER_NAME,
  GeminiFailureLogPayload,
  GeminiMetricsStore,
  GeminiMonitoringContext,
  GeminiPromptBreakdown,
  GeminiUsageDashboardData,
  GeminiUsageLogPayload,
  GeminiUsageMetrics,
  GeminiUsageRecord,
  resolveApplicationName,
  resolveEnvironment,
} from './gemini-observability';
import { extractPromptBreakdown } from './gemini-prompt-breakdown';
import { sanitizeGeminiGenerationConfig } from './llm-model.constants';
import {
  getPromptCompositionAuditService,
  PromptCompositionAuditReport,
  PromptCompositionAuditService,
  PromptTokenSourceReport,
  resetPromptCompositionAuditService,
} from './prompt-composition-audit.service';

const VERTEX_LOCATION = 'global';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SERVICE_ACCOUNT_ENV = 'SIMPLCASE_SERVICE_ACC_JSON';

export type {
  GeminiMonitoringContext,
  GeminiPromptBreakdown,
  PromptCompositionAuditReport,
  PromptTokenSourceReport,
};

export interface LlmGenerateContentParams {
  model: string;
  contents:
    | string
    | Array<{ role?: string; parts?: Array<{ text?: string }> }>;
  config?: {
    systemInstruction?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    thinkingConfig?: { thinkingLevel?: string };
    tools?: unknown[];
    [key: string]: unknown;
  };
  monitoring?: GeminiMonitoringContext;
}

interface ServiceAccountJson {
  type?: string;
  project_id: string;
  private_key: string;
  client_email: string;
  private_key_id?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
}

let providerInstance: GeminiProvider | null = null;

export function getGeminiProvider(): GeminiProvider {
  if (!providerInstance) {
    providerInstance = new GeminiProvider();
  }
  return providerInstance;
}

export function resetGeminiProvider(): void {
  providerInstance = null;
  resetPromptCompositionAuditService();
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env[SERVICE_ACCOUNT_ENV]?.trim());
}

@Injectable()
export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenAI;
  private readonly projectId: string;
  private readonly location = VERTEX_LOCATION;
  private readonly metricsStore = new GeminiMetricsStore();
  private readonly promptCompositionAudit = getPromptCompositionAuditService();
  private readonly applicationName = resolveApplicationName();
  private readonly environment = resolveEnvironment();

  constructor() {
    const { projectId, credentials } = this.loadCredentials();
    this.projectId = projectId;

    this.logger.log('Creating Vertex AI Gemini client', {
      projectId,
      location: this.location,
    });

    try {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location: this.location,
        googleAuthOptions: {
          credentials,
          scopes: [VERTEX_SCOPE],
        },
      });

      this.logger.log('Vertex AI Gemini client authenticated successfully', {
        projectId,
        location: this.location,
      });
    } catch (error) {
      this.logger.error('Vertex AI Gemini authentication failed', {
        projectId,
        location: this.location,
        error: extractErrorMessage(error),
      });
      throw error;
    }
  }

  async generate(params: LlmGenerateContentParams): Promise<unknown> {
    return this.generateContent(params);
  }

  async generateContent(params: LlmGenerateContentParams): Promise<unknown> {
    const { model, monitoring } = params;
    const requestId = createRequestId(monitoring?.request_id);
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();

    this.logger.log('Vertex AI generateContent request', {
      request_id: requestId,
      projectId: this.projectId,
      location: this.location,
      model,
      conversation_id: monitoring?.conversation_id,
      user_id: monitoring?.user_id,
    });

    const compositionAudit = this.promptCompositionAudit.analyzeRequest({
      requestId,
      conversationId: monitoring?.conversation_id,
      model,
      params,
    });

    try {
      const result = await this.client.models.generateContent(
        this.toApiParams(params),
      );

      const latencyMs = Date.now() - startedAt;
      const usage = extractUsageFromResponse(result);
      const promptBreakdown = extractPromptBreakdown(params, usage.input_tokens);

      this.logUsage({
        timestamp,
        request_id: requestId,
        conversation_id: monitoring?.conversation_id,
        user_id: monitoring?.user_id,
        application_name: this.applicationName,
        environment: this.environment,
        provider: GEMINI_PROVIDER_NAME,
        model,
        region: this.location,
        status: 'success',
        latency_ms: latencyMs,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        cached_tokens: usage.cached_tokens,
        system_prompt_tokens: promptBreakdown.system_prompt_tokens,
        history_tokens: promptBreakdown.history_tokens,
        retrieval_tokens: promptBreakdown.retrieval_tokens,
        query_tokens: promptBreakdown.query_tokens,
      });

      this.promptCompositionAudit.recordAudit(
        compositionAudit,
        usage.input_tokens,
      );

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorCode = extractErrorCode(error);
      const errorMessage = extractErrorMessage(error);

      this.logFailure({
        timestamp,
        request_id: requestId,
        conversation_id: monitoring?.conversation_id,
        user_id: monitoring?.user_id,
        application_name: this.applicationName,
        environment: this.environment,
        provider: GEMINI_PROVIDER_NAME,
        model,
        region: this.location,
        status: 'failed',
        latency_ms: latencyMs,
        error_code: errorCode,
        error_message: errorMessage,
      });

      this.promptCompositionAudit.recordAudit(compositionAudit, 0);

      throw error;
    }
  }

  logUsage(record: GeminiUsageRecord): void {
    const payload: GeminiUsageLogPayload = {
      event: 'gemini_usage',
      timestamp: record.timestamp,
      request_id: record.request_id,
      conversation_id: record.conversation_id,
      user_id: record.user_id,
      application_name: record.application_name,
      environment: record.environment,
      provider: GEMINI_PROVIDER_NAME,
      model: record.model,
      region: record.region,
      status: 'success',
      latency_ms: record.latency_ms,
      input_tokens: record.input_tokens ?? 0,
      output_tokens: record.output_tokens ?? 0,
      total_tokens: record.total_tokens ?? 0,
      cached_tokens: record.cached_tokens ?? 0,
      system_prompt_tokens: record.system_prompt_tokens ?? 0,
      history_tokens: record.history_tokens ?? 0,
      retrieval_tokens: record.retrieval_tokens ?? 0,
      query_tokens: record.query_tokens ?? 0,
    };

    this.metricsStore.add(record);
    this.emitStructuredLog(payload);
  }

  logFailure(record: GeminiUsageRecord): void {
    const payload: GeminiFailureLogPayload = {
      event: 'gemini_failure',
      timestamp: record.timestamp,
      request_id: record.request_id,
      conversation_id: record.conversation_id,
      user_id: record.user_id,
      application_name: record.application_name,
      environment: record.environment,
      provider: GEMINI_PROVIDER_NAME,
      model: record.model,
      region: record.region,
      status: 'failed',
      latency_ms: record.latency_ms,
      error_code: record.error_code ?? 'UNKNOWN',
      error_message: record.error_message ?? 'Unknown error',
    };

    this.metricsStore.add(record);
    this.emitStructuredLog(payload);
  }

  getUsageMetrics(): GeminiUsageMetrics {
    return this.metricsStore.buildMetrics();
  }

  buildUsageDashboardData(): GeminiUsageDashboardData {
    return this.metricsStore.buildDashboardData(
      this.applicationName,
      this.environment,
    );
  }

  getPromptCompositionAuditService(): PromptCompositionAuditService {
    return this.promptCompositionAudit;
  }

  getTokenSourceReport(): PromptTokenSourceReport {
    return this.promptCompositionAudit.getTokenSourceReport();
  }

  buildPromptCompositionAuditReport(): PromptCompositionAuditReport {
    return this.promptCompositionAudit.buildAuditReport();
  }

  private toApiParams(
    params: LlmGenerateContentParams,
  ): Parameters<GoogleGenAI['models']['generateContent']>[0] {
    const { monitoring: _monitoring, model, config, ...rest } = params;
    const sanitizedConfig = sanitizeGeminiGenerationConfig(model, config);
    return {
      model,
      ...rest,
      ...(sanitizedConfig ? { config: sanitizedConfig } : {}),
    } as Parameters<GoogleGenAI['models']['generateContent']>[0];
  }

  private emitStructuredLog(payload: GeminiUsageLogPayload | GeminiFailureLogPayload): void {
    console.log(JSON.stringify(payload));
  }

  private loadCredentials(): {
    projectId: string;
    credentials: CredentialBody;
  } {
    const raw = process.env[SERVICE_ACCOUNT_ENV]?.trim();
    if (!raw) {
      throw new Error(
        `${SERVICE_ACCOUNT_ENV} is not configured. Load the service account JSON from Secret Manager before initializing GeminiProvider.`,
      );
    }

    let parsed: ServiceAccountJson;
    try {
      parsed = JSON.parse(raw) as ServiceAccountJson;
    } catch (error) {
      this.logger.error('Failed to parse service account JSON', {
        error: extractErrorMessage(error),
      });
      throw new Error(
        `${SERVICE_ACCOUNT_ENV} must contain valid service account JSON`,
      );
    }

    const projectId = parsed.project_id?.trim();
    const privateKey = parsed.private_key?.trim();
    const clientEmail = parsed.client_email?.trim();

    if (!projectId || !privateKey || !clientEmail) {
      throw new Error(
        `${SERVICE_ACCOUNT_ENV} must include project_id, private_key, and client_email`,
      );
    }

    const credentials: CredentialBody = {
      client_email: clientEmail,
      private_key: privateKey,
    };

    return { projectId, credentials };
  }
}
