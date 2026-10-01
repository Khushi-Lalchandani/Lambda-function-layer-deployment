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
exports.PlannerService = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = __importDefault(require("openai"));
const planner_config_1 = require("./planner-config");
const planner_strategy_mapper_1 = require("./planner-strategy-mapper");
const planner_tools_1 = require("./planner-tools");
const conversation_history_util_1 = require("./conversation-history.util");
const bare_assent_query_util_1 = require("./bare-assent-query.util");
const platform_starter_query_util_1 = require("./platform-starter-query.util");
const summary_query_util_1 = require("./summary-query.util");
const request_observability_1 = require("./request-observability");
let PlannerService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var PlannerService = _classThis = class {
        constructor(promptTemplateService) {
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(PlannerService.name);
            this.openaiClient = null;
        }
        async plan(originalQuery, subQuery, conversationHistory, conversationSummary) {
            const trimmedSubQuery = (subQuery ?? '').trim();
            if (!trimmedSubQuery) {
                return this.emptyPlan(originalQuery, subQuery);
            }
            if ((0, platform_starter_query_util_1.isPlatformStarterQuery)(trimmedSubQuery) ||
                (0, platform_starter_query_util_1.isPlatformStarterQuery)(originalQuery)) {
                return {
                    originalQuery,
                    subQuery: trimmedSubQuery,
                    actions: [
                        {
                            tool: 'DOCUMENT_FIRST',
                            query: trimmedSubQuery,
                            reason: 'Platform-generated starter question',
                        },
                    ],
                    confidence: 'high',
                    reasoning: 'Forced DOCUMENT_FIRST for platform starter question',
                };
            }
            try {
                const response = await this.getOpenAI().chat.completions.create({
                    model: planner_config_1.plannerConfig.model,
                    messages: this.buildMessages(trimmedSubQuery, conversationHistory, conversationSummary),
                    tools: (0, planner_tools_1.buildPlannerTools)(),
                    tool_choice: 'required',
                    reasoning_effort: 'medium',
                });
                const actions = this.guardScopedSummaryMisroute(trimmedSubQuery, this.guardBareAssentMisroute(trimmedSubQuery, this.parseToolCalls(response, trimmedSubQuery), conversationHistory));
                if (actions.length === 0) {
                    return this.emptyPlan(originalQuery, trimmedSubQuery, 'low');
                }
                return {
                    originalQuery,
                    subQuery: trimmedSubQuery,
                    actions,
                    confidence: this.inferConfidence(actions),
                    reasoning: this.extractReasoning(response),
                };
            }
            catch (error) {
                this.logger.warn(`[Planner] Planning failed for "${trimmedSubQuery}": ${error.message}`);
                return this.emptyPlan(originalQuery, trimmedSubQuery, 'low');
            }
        }
        async planAll(originalQuery, subQueries, conversationHistory, conversationSummary) {
            const queries = subQueries.length > 0 ? subQueries : [originalQuery.trim()].filter(Boolean);
            return Promise.all(queries.map((subQuery) => this.plan(originalQuery, subQuery, conversationHistory, conversationSummary)));
        }
        logPlannerResult(result) {
            const mappedStrategies = (0, planner_strategy_mapper_1.mapPlannerActionsToStrategies)(result.actions);
            for (const action of result.actions) {
                (0, request_observability_1.logDebug)('PLANNER_ACTION', {
                    query: action.query,
                    capability: action.tool,
                    reason: action.reason ?? result.reasoning ?? 'not provided',
                });
            }
            (0, request_observability_1.logDebug)('PLANNER_RESULT', {
                originalQuery: result.originalQuery,
                subQuery: result.subQuery,
                actions: result.actions.map((action) => action.tool),
                confidence: result.confidence,
                mappedStrategies,
            });
        }
        logPlannerComparison(comparison) {
            const primaryCapability = comparison.plannerActions[0] ?? 'none';
            (0, request_observability_1.logDebug)('PLANNER_COMPARISON', {
                legacyStrategy: comparison.existingStrategy,
                plannerCapability: primaryCapability,
                matched: comparison.matched,
                comparison,
            });
        }
        buildComparison(query, existingStrategy, plannerResults) {
            const actions = plannerResults.flatMap((result) => result.actions);
            return (0, planner_strategy_mapper_1.comparePlannerWithExisting)(query, existingStrategy, actions);
        }
        getOpenAI() {
            if (!this.openaiClient) {
                const apiKey = process.env.OPENAI_KEY;
                if (!apiKey) {
                    throw new Error('OPENAI_KEY is required for planner service');
                }
                this.openaiClient = new openai_1.default({ apiKey });
            }
            return this.openaiClient;
        }
        buildMessages(query, conversationHistory, conversationSummary) {
            const systemPrompt = this.promptTemplateService.getTemplate('planner-system.txt');
            const summarySection = (0, conversation_history_util_1.buildSummarySection)(conversationSummary);
            const historySection = (0, conversation_history_util_1.buildNumberedTurnHistorySection)(conversationHistory ?? []);
            const followUpNote = (0, bare_assent_query_util_1.isBareAssentQuery)(query) && (conversationHistory?.length ?? 0) > 0
                ? '\n\nNote: This is a bare affirmative follow-up. Resolve it from the immediately preceding assistant turn — do NOT select GREETING.'
                : '';
            return [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `User query: "${query}"${followUpNote}${summarySection ? `\n\n${summarySection}` : ''}${historySection ? `\n\n${historySection}` : ''}`,
                },
            ];
        }
        guardBareAssentMisroute(query, actions, conversationHistory) {
            if (!(0, bare_assent_query_util_1.isBareAssentQuery)(query) || !(conversationHistory?.length ?? 0)) {
                return actions;
            }
            const withoutGreeting = actions.filter((action) => action.tool !== 'GREETING');
            if (withoutGreeting.length > 0) {
                return withoutGreeting;
            }
            if (actions.length === 0) {
                return actions;
            }
            return [
                {
                    tool: 'DOCUMENT_FIRST',
                    query,
                    reason: 'Bare assent follow-up with conversation context; GREETING is not applicable',
                },
            ];
        }
        guardScopedSummaryMisroute(query, actions) {
            const isSingleScopedSummary = actions.length === 1 && (0, summary_query_util_1.isDocumentScopedSummaryQuery)(query);
            return actions.map((action) => {
                if (action.tool !== 'CASE_SUMMARY' ||
                    (!(0, summary_query_util_1.isDocumentScopedSummaryQuery)(action.query) && !isSingleScopedSummary)) {
                    return action;
                }
                return {
                    ...action,
                    tool: 'DOCUMENT_FIRST',
                    reason: 'Section- or clause-specific summary requires document retrieval, not whole-document summary',
                };
            });
        }
        parseToolCalls(response, fallbackQuery) {
            const toolCalls = response.choices?.[0]?.message?.tool_calls ?? [];
            const actions = [];
            for (const toolCall of toolCalls) {
                if (toolCall.type !== 'function') {
                    continue;
                }
                const toolName = toolCall.function.name;
                if (!(0, planner_tools_1.isPlannerToolName)(toolName)) {
                    continue;
                }
                const parsedArgs = this.parseToolArguments(toolCall.function.arguments, fallbackQuery);
                actions.push({
                    tool: toolName,
                    query: parsedArgs.query,
                    reason: parsedArgs.reason,
                });
            }
            return actions;
        }
        parseToolArguments(rawArguments, fallbackQuery) {
            try {
                const parsed = JSON.parse(rawArguments);
                return {
                    query: parsed.query?.trim() || fallbackQuery,
                    reason: parsed.reason?.trim(),
                };
            }
            catch {
                return { query: fallbackQuery };
            }
        }
        inferConfidence(actions) {
            if (actions.length === 0) {
                return 'low';
            }
            if (actions.length === 1) {
                return 'high';
            }
            return 'medium';
        }
        extractReasoning(response) {
            const content = response.choices?.[0]?.message?.content?.trim();
            return content || undefined;
        }
        emptyPlan(originalQuery, subQuery, confidence = 'low') {
            return {
                originalQuery,
                subQuery,
                actions: [],
                confidence,
            };
        }
    };
    __setFunctionName(_classThis, "PlannerService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        PlannerService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return PlannerService = _classThis;
})();
exports.PlannerService = PlannerService;
//# sourceMappingURL=planner.service.js.map