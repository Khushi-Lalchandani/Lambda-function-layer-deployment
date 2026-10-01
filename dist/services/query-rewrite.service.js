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
exports.QueryRewriteService = void 0;
const common_1 = require("@nestjs/common");
const conversation_history_util_1 = require("./conversation-history.util");
const llm_gateway_service_1 = require("./llm-gateway.service");
const bare_assent_query_util_1 = require("./bare-assent-query.util");
const explicit_web_search_query_util_1 = require("./explicit-web-search-query.util");
const query_rewrite_config_1 = require("./query-rewrite-config");
const request_observability_1 = require("./request-observability");
let QueryRewriteService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var QueryRewriteService = _classThis = class {
        constructor(promptTemplateService) {
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(QueryRewriteService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
        }
        async rewrite(query, conversationHistory, _caseContext) {
            const originalQuery = (query ?? '').trim();
            if (!originalQuery) {
                return this.noRewrite(originalQuery);
            }
            const messages = conversationHistory ?? [];
            const historyContext = this.buildHistoryContext(messages);
            try {
                const llmResult = await this.rewriteWithLlm(originalQuery, messages, historyContext);
                const confidence = llmResult.confidence ?? 'low';
                if (confidence !== 'high' || !llmResult.rewritten_query?.trim()) {
                    const result = this.noRewrite(originalQuery);
                    this.logRewriteOutcome(result, historyContext, {
                        llmInvoked: true,
                        confidence,
                        reason: llmResult.rewrite_reason ?? 'low confidence or empty rewrite',
                        historyUsed: llmResult.history_used,
                    });
                    return result;
                }
                const rewrittenQuery = llmResult.rewritten_query.trim();
                const wasRewritten = llmResult.was_rewritten === true &&
                    rewrittenQuery.toLowerCase() !== originalQuery.toLowerCase();
                if (wasRewritten &&
                    this.hasUnresolvedReference(originalQuery) &&
                    this.hasUnresolvedReference(rewrittenQuery)) {
                    const result = this.noRewrite(originalQuery);
                    this.logRewriteOutcome(result, historyContext, {
                        llmInvoked: true,
                        confidence,
                        reason: 'reference still unresolved after rewrite',
                        historyUsed: llmResult.history_used,
                    });
                    return result;
                }
                if (!wasRewritten) {
                    const result = this.noRewrite(originalQuery);
                    this.logRewriteOutcome(result, historyContext, {
                        llmInvoked: true,
                        confidence,
                        reason: llmResult.rewrite_reason ?? 'unchanged query',
                        historyUsed: llmResult.history_used,
                    });
                    return result;
                }
                if (this.isBareProximityQuery(originalQuery) &&
                    !this.citesAnchorTurn(llmResult.rewrite_reason)) {
                    const result = this.noRewrite(originalQuery);
                    this.logRewriteOutcome(result, historyContext, {
                        llmInvoked: true,
                        confidence,
                        reason: 'bare proximity rewrite missing anchor turn citation',
                        historyUsed: llmResult.history_used,
                    });
                    return result;
                }
                if ((0, bare_assent_query_util_1.isBareAssentQuery)(originalQuery)) {
                    const assentValidation = this.validateBareAssentRewrite(llmResult, rewrittenQuery);
                    if (!assentValidation.valid) {
                        const result = this.noRewrite(originalQuery);
                        this.logRewriteOutcome(result, historyContext, {
                            llmInvoked: true,
                            confidence,
                            reason: assentValidation.reason,
                            historyUsed: llmResult.history_used,
                        });
                        return result;
                    }
                }
                const result = {
                    originalQuery,
                    rewrittenQuery,
                    wasRewritten: true,
                    rewriteReason: llmResult.rewrite_reason?.trim() || 'LLM rewrite',
                    historyUsed: llmResult.history_used === true,
                    intent: llmResult.intent === 'accept_web_search_offer'
                        ? 'accept_web_search_offer'
                        : undefined,
                };
                this.logRewriteOutcome(result, historyContext, {
                    llmInvoked: true,
                    confidence,
                    reason: result.rewriteReason ?? 'LLM rewrite',
                    historyUsed: llmResult.history_used,
                });
                return result;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`[QueryRewrite] LLM rewrite failed, falling back: ${message}`);
                const result = this.noRewrite(originalQuery);
                this.logRewriteOutcome(result, historyContext, {
                    llmInvoked: true,
                    confidence: 'low',
                    reason: 'LLM failure fallback',
                });
                return result;
            }
        }
        logRewriteResult(result, conversationHistory) {
            this.logRewriteOutcome(result, this.buildHistoryContext(conversationHistory ?? []), {
                llmInvoked: true,
                confidence: result.wasRewritten ? 'high' : 'low',
                reason: result.rewriteReason ?? 'none',
            });
        }
        buildHistoryContext(messages) {
            const historySent = (0, conversation_history_util_1.formatNumberedTurnHistory)(messages);
            return {
                messageCount: messages.length,
                turnCount: (0, conversation_history_util_1.countConversationTurns)(messages),
                historySent,
            };
        }
        logRewriteOutcome(result, historyContext, details) {
            const finalPipelineQuery = result.wasRewritten
                ? result.rewrittenQuery
                : result.originalQuery;
            (0, request_observability_1.logQueryRewrite)({
                originalQuery: result.originalQuery,
                rewrittenQuery: finalPipelineQuery,
                wasRewritten: result.wasRewritten,
                reason: details.reason,
                historyMessageCount: historyContext.messageCount,
                historyTurnCount: historyContext.turnCount,
                historyUsed: details.historyUsed ?? false,
                historyChars: historyContext.historySent.length,
            });
        }
        async rewriteWithLlm(query, messages, historyContext) {
            const historySection = (0, conversation_history_util_1.buildNumberedTurnHistorySection)(messages);
            const systemInstruction = this.promptTemplateService.renderTemplate('query-pre-rewrite.txt', {});
            const userPrompt = `
[History]
${historySection}
Current query:
${query}
`;
            (0, request_observability_1.logQueryRewriteHistory)({
                historySent: historyContext.historySent,
                llmUserPrompt: userPrompt.trim(),
            });
            const jsonSchema = {
                type: 'object',
                properties: {
                    rewritten_query: {
                        type: 'string',
                        description: 'The rewritten query or the original query if unchanged.',
                    },
                    was_rewritten: {
                        type: 'boolean',
                        description: 'Whether the query was modified using history or grammar.',
                    },
                    rewrite_reason: {
                        type: 'string',
                        nullable: true,
                        description: 'A brief description of why the rewrite happened, or null.',
                    },
                    history_used: {
                        type: 'boolean',
                        description: 'True if history was used to resolve references, false otherwise.',
                    },
                    confidence: {
                        type: 'string',
                        enum: ['high', 'low', 'medium'],
                        description: 'High if references are resolved with certainty, including explicit deliverable corrections (e.g. overview not timeline). Medium or low only for ambiguous bare-proximity dissatisfaction or when unchanged.',
                    },
                    intent: {
                        type: 'string',
                        nullable: true,
                        enum: ['accept_web_search_offer'],
                        description: 'Set to accept_web_search_offer ONLY when resolving bare assent to a prior Assistant offer to search outside documents or search the web. For other bare assent resolutions, set null.',
                    },
                },
                required: [
                    'rewritten_query',
                    'was_rewritten',
                    'rewrite_reason',
                    'history_used',
                    'confidence',
                    'intent',
                ],
            };
            const response = await this.llm.generateContent({
                model: query_rewrite_config_1.queryRewriteConfig.model,
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                config: {
                    systemInstruction,
                    temperature: 0,
                    topP: 0.1,
                    topK: 1,
                    responseMimeType: 'application/json',
                    responseSchema: jsonSchema,
                },
            });
            const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
            return this.parseLlmResponse(responseText);
        }
        parseLlmResponse(responseText) {
            try {
                return JSON.parse(responseText);
            }
            catch (error) {
                this.logger.warn(`Failed parsing raw JSON response: ${responseText}. Falling back to regex parser.`);
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return {
                        rewritten_query: '',
                        was_rewritten: false,
                        rewrite_reason: 'Parsing failed',
                        history_used: false,
                        confidence: 'low',
                    };
                }
                try {
                    return JSON.parse(jsonMatch[0]);
                }
                catch {
                    return {
                        rewritten_query: '',
                        was_rewritten: false,
                        rewrite_reason: 'Parsing failed',
                        history_used: false,
                        confidence: 'low',
                    };
                }
            }
        }
        hasUnresolvedReference(query) {
            const referencePatterns = [
                /\b(first|second|third|fourth|fifth|last|\d+(?:st|nd|rd|th))\s+point\b/i,
                /\b(above|previous|earlier)\s+(?:answer|explanation|question)\b/i,
                /\b(?:i\s+)?meant\s+above\b/i,
                /\bmentioned\s+(?:above|earlier|in\s+the\s+above)\b/i,
                /\bin\s+the\s+above\s+answer\b/i,
                /\bmentioned\s+above\b/i,
                /\bas\s+per\s+(?:the\s+)?above\b/i,
            ];
            return referencePatterns.some((pattern) => pattern.test(query));
        }
        isBareProximityQuery(query) {
            const bareProximityPatterns = [
                /\b(?:i\s+)?meant\s+(?:above|that|this|previous|earlier)\b/i,
                /^\s*(?:i\s+meant\s+)?(?:above|that|this)\s+as\s+per\b/i,
                /\b(?:no,?\s+)?(?:above|that|this|previous|earlier)\s+as\s+per\b/i,
            ];
            return bareProximityPatterns.some((pattern) => pattern.test(query));
        }
        citesAnchorTurn(reason) {
            return /\bTurn\s+\d+\b/i.test(reason ?? '');
        }
        validateBareAssentRewrite(llmResult, rewrittenQuery) {
            if (!this.citesAnchorTurn(llmResult.rewrite_reason)) {
                return {
                    valid: false,
                    reason: 'bare assent rewrite missing anchor turn citation',
                };
            }
            if ((0, bare_assent_query_util_1.isBareAssentQuery)(rewrittenQuery)) {
                return {
                    valid: false,
                    reason: 'bare assent rewrite still unresolved',
                };
            }
            if (llmResult.intent === 'accept_web_search_offer') {
                if (!(0, explicit_web_search_query_util_1.isExplicitWebSearchQuery)(rewrittenQuery)) {
                    return {
                        valid: false,
                        reason: 'bare assent rewrite must produce an explicit web search query',
                    };
                }
                return { valid: true, reason: '' };
            }
            return { valid: true, reason: '' };
        }
        noRewrite(originalQuery) {
            return {
                originalQuery,
                rewrittenQuery: originalQuery,
                wasRewritten: false,
            };
        }
    };
    __setFunctionName(_classThis, "QueryRewriteService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        QueryRewriteService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return QueryRewriteService = _classThis;
})();
exports.QueryRewriteService = QueryRewriteService;
//# sourceMappingURL=query-rewrite.service.js.map