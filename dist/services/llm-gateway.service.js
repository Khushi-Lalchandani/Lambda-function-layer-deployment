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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmGatewayService = void 0;
exports.getLlmGateway = getLlmGateway;
exports.resetLlmGateway = resetLlmGateway;
const common_1 = require("@nestjs/common");
const openai_1 = __importDefault(require("openai"));
const gemini_provider_1 = require("./gemini-provider");
const llm_model_constants_1 = require("./llm-model.constants");
const OPENAI_GPT5_FAMILY_MODELS = new Set(['gpt-5-mini']);
const OPENAI_REASONING_EFFORTS = new Set([
    'minimal',
    'low',
    'medium',
    'high',
]);
function resolveOpenAiReasoningEffort(config) {
    const effort = config?.reasoning_effort;
    if (typeof effort === 'string' &&
        OPENAI_REASONING_EFFORTS.has(effort)) {
        return effort;
    }
    return 'minimal';
}
function isOpenAiGpt5FamilyModel(model) {
    return OPENAI_GPT5_FAMILY_MODELS.has(model.toLowerCase());
}
let gatewayInstance = null;
function getLlmGateway() {
    if (!gatewayInstance) {
        gatewayInstance = new LlmGatewayService();
    }
    return gatewayInstance;
}
function resetLlmGateway() {
    gatewayInstance = null;
    (0, gemini_provider_1.resetGeminiProvider)();
}
let LlmGatewayService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var LlmGatewayService = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(LlmGatewayService.name);
            this.gemini = (0, gemini_provider_1.getGeminiProvider)();
            this.openaiClient = null;
        }
        getOpenAI() {
            if (!this.openaiClient) {
                const apiKey = process.env.OPENAI_KEY;
                if (!apiKey) {
                    throw new Error('OPENAI_KEY is not configured');
                }
                this.openaiClient = new openai_1.default({ apiKey });
            }
            return this.openaiClient;
        }
        async generateContent(params) {
            let geminiFailureReason = '';
            try {
                const result = await this.gemini.generateContent(params);
                if (!this.isInvalidResponse(result)) {
                    return result;
                }
                geminiFailureReason = 'empty or invalid response';
            }
            catch (error) {
                geminiFailureReason = this.describeError(error);
            }
            if (!process.env.OPENAI_KEY) {
                throw new Error(`Gemini failed (${geminiFailureReason}) and OPENAI_KEY is not configured for fallback`);
            }
            this.logger.warn(`[LLM_FALLBACK] Gemini failed (${geminiFailureReason}); retrying with OpenAI for model=${params.model}`);
            return this.generateWithOpenAI(params);
        }
        /**
         * Tries Gemini with params.model first; on failure retries with an explicit OpenAI model.
         */
        async generateContentWithExplicitOpenAiFallback(params, openAiFallbackModel) {
            let geminiFailureReason = '';
            try {
                const result = await this.gemini.generateContent(params);
                if (!this.isInvalidResponse(result)) {
                    return {
                        response: result,
                        modelUsed: params.model,
                        fallbackUsed: false,
                    };
                }
                geminiFailureReason = 'empty or invalid response';
            }
            catch (error) {
                geminiFailureReason = this.describeError(error);
            }
            if (!process.env.OPENAI_KEY) {
                throw new Error(`Gemini failed (${geminiFailureReason}) and OPENAI_KEY is not configured for fallback`);
            }
            this.logger.warn(`[LLM_FALLBACK] Gemini failed (${geminiFailureReason}); retrying with OpenAI model=${openAiFallbackModel} (Gemini model was ${params.model})`);
            const response = await this.generateWithOpenAI(params, openAiFallbackModel, 'fallback');
            return {
                response,
                modelUsed: openAiFallbackModel,
                fallbackUsed: true,
            };
        }
        async generateContentOpenAiFirst(params, options) {
            const openAiModel = options?.openAiModel ?? llm_model_constants_1.OPENAI_DEFAULT_MODEL;
            const geminiFallbackModel = options?.geminiFallbackModel ??
                params.model ??
                llm_model_constants_1.DEFAULT_GEMINI_FALLBACK_MODEL;
            let openAiFailureReason = '';
            if (process.env.OPENAI_KEY) {
                try {
                    const result = await this.generateWithOpenAI(params, openAiModel, 'primary');
                    if (!this.isInvalidResponse(result)) {
                        this.logger.log(`[LLM_PRIMARY] OpenAI succeeded with model=${openAiModel}`);
                        return result;
                    }
                    openAiFailureReason = 'empty or invalid response';
                }
                catch (error) {
                    openAiFailureReason = this.describeError(error);
                }
            }
            else {
                openAiFailureReason = 'OPENAI_KEY is not configured';
            }
            this.logger.warn(`[LLM_FALLBACK] OpenAI failed (${openAiFailureReason}); retrying with Gemini model=${geminiFallbackModel}`);
            try {
                const geminiResult = await this.gemini.generateContent({
                    ...params,
                    model: geminiFallbackModel,
                });
                if (!this.isInvalidResponse(geminiResult)) {
                    return geminiResult;
                }
                throw new Error('Gemini fallback returned empty response');
            }
            catch (error) {
                throw new Error(`OpenAI failed (${openAiFailureReason}) and Gemini fallback failed (${this.describeError(error)})`);
            }
        }
        async generateWithOpenAI(params, openAiModelOverride, callPath = 'fallback') {
            const openAiStartTime = Date.now();
            const openAiModel = openAiModelOverride ??
                llm_model_constants_1.GEMINI_TO_OPENAI_MODEL[params.model] ??
                llm_model_constants_1.OPENAI_DEFAULT_MODEL;
            const messages = this.buildOpenAiMessages(params);
            const wantsJson = params.config?.responseMimeType === 'application/json';
            const request = {
                model: openAiModel,
                messages,
                max_tokens: params.config?.maxOutputTokens,
                ...(wantsJson
                    ? { response_format: { type: 'json_object' } }
                    : {}),
            };
            if (isOpenAiGpt5FamilyModel(openAiModel)) {
                // Chat Completions uses top-level reasoning_effort (not nested reasoning).
                request.reasoning_effort = resolveOpenAiReasoningEffort(params.config);
            }
            else {
                request.temperature = params.config?.temperature ?? 0;
                if (params.config?.topP != null) {
                    request.top_p = params.config.topP;
                }
            }
            const response = await this.getOpenAI().chat.completions.create(request);
            const text = (response.choices[0]?.message?.content ?? '').trim();
            if (!text) {
                throw new Error('OpenAI fallback returned empty response');
            }
            const openAiDurationMs = Date.now() - openAiStartTime;
            if (callPath === 'primary') {
                this.logger.log(`[LLM_OPENAI_PRIMARY] OpenAI call completed in ${openAiDurationMs}ms with model=${openAiModel}`);
            }
            else {
                this.logger.log(`[LLM_OPENAI_FALLBACK] OpenAI fallback call completed in ${openAiDurationMs}ms with model=${openAiModel} (Gemini model was ${params.model})`);
            }
            return {
                text,
                candidates: [{ content: { parts: [{ text }] } }],
            };
        }
        buildOpenAiMessages(params) {
            const messages = [];
            if (params.config?.systemInstruction) {
                messages.push({
                    role: 'system',
                    content: String(params.config.systemInstruction),
                });
            }
            if (typeof params.contents === 'string') {
                messages.push({ role: 'user', content: params.contents });
                return messages;
            }
            for (const entry of params.contents ?? []) {
                const text = (entry.parts ?? [])
                    .map((part) => part.text ?? '')
                    .join('\n')
                    .trim();
                if (!text) {
                    continue;
                }
                const role = entry.role === 'model' ? 'assistant' : 'user';
                messages.push({ role, content: text });
            }
            if (!messages.some((message) => message.role === 'user')) {
                messages.push({ role: 'user', content: '' });
            }
            return messages;
        }
        isInvalidResponse(response) {
            const text = this.extractText(response);
            return !text.trim();
        }
        extractText(response) {
            if (!response || typeof response !== 'object') {
                return '';
            }
            const res = response;
            if (typeof res.text === 'function') {
                return String(res.text()).trim();
            }
            if (typeof res.text === 'string') {
                return res.text.trim();
            }
            const parts = res.candidates?.[0]?.content?.parts ?? [];
            return parts
                .map((part) => part.text ?? '')
                .join('')
                .trim();
        }
        describeError(error) {
            if (error instanceof Error) {
                return error.message;
            }
            return String(error);
        }
    };
    __setFunctionName(_classThis, "LlmGatewayService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        LlmGatewayService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return LlmGatewayService = _classThis;
})();
exports.LlmGatewayService = LlmGatewayService;
//# sourceMappingURL=llm-gateway.service.js.map