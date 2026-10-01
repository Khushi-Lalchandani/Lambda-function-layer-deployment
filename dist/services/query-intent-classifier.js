"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyQueryIntent = classifyQueryIntent;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const llm_model_constants_1 = require("./llm-model.constants");
const request_observability_1 = require("./request-observability");
const logger = new common_1.Logger('QueryIntentClassifier');
const classifierCache = new Map();
const MAX_CACHE_SIZE = 200;
function setCacheValue(cacheKey, intent) {
    if (classifierCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = classifierCache.keys().next().value;
        classifierCache.delete(oldestKey);
    }
    classifierCache.set(cacheKey, intent);
}
function fallbackHeuristicIntent(query) {
    const normalizedQuery = (query ?? '').trim().toLowerCase();
    if (!normalizedQuery) {
        return 'REASONING';
    }
    // Procedural/remedy queries need actionable reasoning, not terse fact extraction
    if (/\b(what\s+(has|needs|need|should|can|must)\s+to?\s*be\s+done|what\s+to\s+do|next\s+steps?|how\s+to\s+proceed|what\s+remedy|remedies|what\s+can\s+i\s+do)\b/i.test(normalizedQuery)) {
        return 'REASONING';
    }
    if (/^(what|who|when|where|which|is|are|was|were|does|do|did|can|has|have)\b/i.test(normalizedQuery)) {
        return 'FACT_LOOKUP';
    }
    if (/\b(explain|compare|summari[sz]e|analysis|why|how)\b/i.test(normalizedQuery)) {
        return 'REASONING';
    }
    return 'REASONING';
}
async function classifyQueryIntent(query) {
    const normalizedQuery = (query ?? '').trim();
    if (!normalizedQuery) {
        (0, request_observability_1.logDebug)('CLASSIFIER', { source: 'empty_query', intent: 'REASONING' });
        return 'REASONING';
    }
    const cacheKey = normalizedQuery.toLowerCase();
    const cached = classifierCache.get(cacheKey);
    if (cached) {
        (0, request_observability_1.logDebug)('CLASSIFIER', {
            source: 'cache',
            intent: cached,
            query: normalizedQuery,
        });
        return cached;
    }
    const prompt = `Classify this legal query based on the user's actual information need.

Labels:

FACT_LOOKUP
- The user needs a specific value that can be directly extracted from the document.
- The answer requires NO interpretation, explanation, or context to be useful.
- Examples: dates, amounts, names, parties, PAN numbers, section numbers, 
  identifiers, addresses, status.
- Rule: If the answer is a number, name, date, or short phrase — and nothing 
  more is needed to satisfy the query — it is FACT_LOOKUP.

REASONING
- The user needs explanation, interpretation, analysis, comparison, summary, 
  chronology, implications, or synthesis.
- Also use REASONING when the query asks for BOTH a fact AND context/reason 
  around it.
- When in doubt, choose REASONING

Consider the user's intent, not just keywords.

Examples:
Query: "What is the PAN number of the assessee?"
{"intent":"FACT_LOOKUP"}
Query: "What is the date of withdrawal of appeal?"
{"intent":"FACT_LOOKUP"}
Query: "Explain why the appeal was dismissed"
{"intent":"REASONING"}
Query: "Compare findings of CIT(A) and ITAT"
{"intent":"REASONING"}
Query: "Summarize the dispute"
{"intent":"REASONING"}
Query: "What remedies are available if Form 4 is not issued despite payment?"
{"intent":"REASONING"}
Query: "What is the assessee's stand on addition under section 68?"
{"intent":"REASONING"}
Query: "Which sections were cited by the AO?"
{"intent":"FACT_LOOKUP"}

Return ONLY JSON in this format:
{"intent":"FACT_LOOKUP"} or {"intent":"REASONING"}

Query: "${normalizedQuery}"`;
    try {
        const response = await (0, llm_gateway_service_1.getLlmGateway)().generateContent({
            model: llm_model_constants_1.GEMINI_3_1_FLASH_LITE,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                temperature: 0,
                topP: 0.95,
                topK: 40,
            },
        });
        let rawText = (response?.text ?? '').toString().trim();
        rawText = rawText.replace(/```json|```/g, '').trim();
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        const intent = parsed.intent === 'FACT_LOOKUP' || parsed.intent === 'REASONING'
            ? parsed.intent
            : fallbackHeuristicIntent(normalizedQuery);
        setCacheValue(cacheKey, intent);
        (0, request_observability_1.logDebug)('CLASSIFIER', {
            source: 'llm',
            intent,
            rawIntent: parsed.intent ?? 'missing',
            query: normalizedQuery,
        });
        return intent;
    }
    catch {
        const intent = fallbackHeuristicIntent(normalizedQuery);
        setCacheValue(cacheKey, intent);
        (0, request_observability_1.logDebug)('CLASSIFIER', {
            source: 'fallback',
            intent,
            query: normalizedQuery,
        });
        return intent;
    }
}
//# sourceMappingURL=query-intent-classifier.js.map