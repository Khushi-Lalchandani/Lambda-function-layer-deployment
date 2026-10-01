"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
exports.getGeminiProvider = getGeminiProvider;
exports.resetGeminiProvider = resetGeminiProvider;
exports.isGeminiConfigured = isGeminiConfigured;
const common_1 = require("@nestjs/common");
const genai_1 = require("@google/genai");
const gemini_observability_1 = require("./gemini-observability");
const gemini_prompt_breakdown_1 = require("./gemini-prompt-breakdown");
const llm_model_constants_1 = require("./llm-model.constants");
const prompt_composition_audit_service_1 = require("./prompt-composition-audit.service");
const VERTEX_LOCATION = 'global';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SERVICE_ACCOUNT_ENV = 'SIMPLCASE_SERVICE_ACC_JSON';
let providerInstance = null;
function getGeminiProvider() {
    if (!providerInstance) {
        providerInstance = new GeminiProvider();
    }
    return providerInstance;
}
function resetGeminiProvider() {
    providerInstance = null;
    (0, prompt_composition_audit_service_1.resetPromptCompositionAuditService)();
}
function isGeminiConfigured() {
    return Boolean(process.env[SERVICE_ACCOUNT_ENV]?.trim());
}
let GeminiProvider = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var GeminiProvider = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(GeminiProvider.name);
            this.location = VERTEX_LOCATION;
            this.metricsStore = new gemini_observability_1.GeminiMetricsStore();
            this.promptCompositionAudit = (0, prompt_composition_audit_service_1.getPromptCompositionAuditService)();
            this.applicationName = (0, gemini_observability_1.resolveApplicationName)();
            this.environment = (0, gemini_observability_1.resolveEnvironment)();
            const { projectId, credentials } = this.loadCredentials();
            this.projectId = projectId;
            this.logger.log('Creating Vertex AI Gemini client', {
                projectId,
                location: this.location,
            });
            try {
                this.client = new genai_1.GoogleGenAI({
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
            }
            catch (error) {
                this.logger.error('Vertex AI Gemini authentication failed', {
                    projectId,
                    location: this.location,
                    error: (0, gemini_observability_1.extractErrorMessage)(error),
                });
                throw error;
            }
        }
        async generate(params) {
            return this.generateContent(params);
        }
        async generateContent(params) {
            const { model, monitoring } = params;
            const requestId = (0, gemini_observability_1.createRequestId)(monitoring?.request_id);
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
                const result = await this.client.models.generateContent(this.toApiParams(params));
                const latencyMs = Date.now() - startedAt;
                const usage = (0, gemini_observability_1.extractUsageFromResponse)(result);
                const promptBreakdown = (0, gemini_prompt_breakdown_1.extractPromptBreakdown)(params, usage.input_tokens);
                this.logUsage({
                    timestamp,
                    request_id: requestId,
                    conversation_id: monitoring?.conversation_id,
                    user_id: monitoring?.user_id,
                    application_name: this.applicationName,
                    environment: this.environment,
                    provider: gemini_observability_1.GEMINI_PROVIDER_NAME,
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
                this.promptCompositionAudit.recordAudit(compositionAudit, usage.input_tokens);
                return result;
            }
            catch (error) {
                const latencyMs = Date.now() - startedAt;
                const errorCode = (0, gemini_observability_1.extractErrorCode)(error);
                const errorMessage = (0, gemini_observability_1.extractErrorMessage)(error);
                this.logFailure({
                    timestamp,
                    request_id: requestId,
                    conversation_id: monitoring?.conversation_id,
                    user_id: monitoring?.user_id,
                    application_name: this.applicationName,
                    environment: this.environment,
                    provider: gemini_observability_1.GEMINI_PROVIDER_NAME,
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
        logUsage(record) {
            const payload = {
                event: 'gemini_usage',
                timestamp: record.timestamp,
                request_id: record.request_id,
                conversation_id: record.conversation_id,
                user_id: record.user_id,
                application_name: record.application_name,
                environment: record.environment,
                provider: gemini_observability_1.GEMINI_PROVIDER_NAME,
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
        logFailure(record) {
            const payload = {
                event: 'gemini_failure',
                timestamp: record.timestamp,
                request_id: record.request_id,
                conversation_id: record.conversation_id,
                user_id: record.user_id,
                application_name: record.application_name,
                environment: record.environment,
                provider: gemini_observability_1.GEMINI_PROVIDER_NAME,
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
        getUsageMetrics() {
            return this.metricsStore.buildMetrics();
        }
        buildUsageDashboardData() {
            return this.metricsStore.buildDashboardData(this.applicationName, this.environment);
        }
        getPromptCompositionAuditService() {
            return this.promptCompositionAudit;
        }
        getTokenSourceReport() {
            return this.promptCompositionAudit.getTokenSourceReport();
        }
        buildPromptCompositionAuditReport() {
            return this.promptCompositionAudit.buildAuditReport();
        }
        toApiParams(params) {
            const { monitoring: _monitoring, model, config, ...rest } = params;
            const sanitizedConfig = (0, llm_model_constants_1.sanitizeGeminiGenerationConfig)(model, config);
            return {
                model,
                ...rest,
                ...(sanitizedConfig ? { config: sanitizedConfig } : {}),
            };
        }
        emitStructuredLog(payload) {
            console.log(JSON.stringify(payload));
        }
        loadCredentials() {
            const raw = process.env[SERVICE_ACCOUNT_ENV]?.trim();
            if (!raw) {
                throw new Error(`${SERVICE_ACCOUNT_ENV} is not configured. Load the service account JSON from Secret Manager before initializing GeminiProvider.`);
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch (error) {
                this.logger.error('Failed to parse service account JSON', {
                    error: (0, gemini_observability_1.extractErrorMessage)(error),
                });
                throw new Error(`${SERVICE_ACCOUNT_ENV} must contain valid service account JSON`);
            }
            const projectId = parsed.project_id?.trim();
            const privateKey = parsed.private_key?.trim();
            const clientEmail = parsed.client_email?.trim();
            if (!projectId || !privateKey || !clientEmail) {
                throw new Error(`${SERVICE_ACCOUNT_ENV} must include project_id, private_key, and client_email`);
            }
            const credentials = {
                client_email: clientEmail,
                private_key: privateKey,
            };
            return { projectId, credentials };
        }
    };
    __setFunctionName(_classThis, "GeminiProvider");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        GeminiProvider = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return GeminiProvider = _classThis;
})();
exports.GeminiProvider = GeminiProvider;
//# sourceMappingURL=gemini-provider.js.map