"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRIEVAL_SKIP_REASONS = void 0;
exports.resolveRetrievalProfile = resolveRetrievalProfile;
exports.getProfileParameters = getProfileParameters;
exports.resolveRetrievalParameters = resolveRetrievalParameters;
exports.logRetrievalSkipped = logRetrievalSkipped;
exports.logRetrievalProfile = logRetrievalProfile;
const retrieval_config_1 = require("./retrieval-config");
const query_intent_classifier_1 = require("./query-intent-classifier");
const request_observability_1 = require("./request-observability");
exports.RETRIEVAL_SKIP_REASONS = {
    METADATA_ONLY: 'metadata_only',
    GREETING_RESPONSE: 'greeting_response',
    CONSERVATIVE_RESPONSE: 'conservative_response',
    WEB_SEARCH_ONLY: 'web_search_only',
    METADATA_SUMMARY_AVAILABLE: 'metadata_summary_available',
};
async function resolveRetrievalProfile(query, explicitProfile) {
    if (explicitProfile) {
        return explicitProfile;
    }
    const queryIntent = await (0, query_intent_classifier_1.classifyQueryIntent)(query);
    return queryIntent === 'FACT_LOOKUP' ? 'fast' : 'deep';
}
function getProfileParameters(profile) {
    const isFast = profile === 'fast';
    const queryIntent = isFast ? 'FACT_LOOKUP' : 'REASONING';
    const poolSize = isFast
        ? retrieval_config_1.retrievalConfig.factLookupPoolSize
        : retrieval_config_1.retrievalConfig.reasoningPoolSize;
    const denseCandidateK = isFast
        ? retrieval_config_1.retrievalConfig.factLookupDenseCandidateK
        : retrieval_config_1.retrievalConfig.reasoningDenseCandidateK;
    const bm25CandidateK = isFast
        ? retrieval_config_1.retrievalConfig.factLookupBm25CandidateK
        : retrieval_config_1.retrievalConfig.reasoningBm25CandidateK;
    const finalTopK = isFast
        ? retrieval_config_1.retrievalConfig.factLookupFinalTopK
        : retrieval_config_1.retrievalConfig.reasoningFinalTopK;
    return {
        profile,
        queryIntent,
        poolSize,
        denseCandidateK,
        bm25CandidateK,
        finalTopK,
        geminiRerank: !isFast && retrieval_config_1.retrievalConfig.useLlmRerank,
    };
}
async function resolveRetrievalParameters(query, options) {
    const profile = await resolveRetrievalProfile(query, options?.profile);
    const configured = getProfileParameters(profile);
    return {
        ...configured,
        poolSize: options?.poolSize ?? configured.poolSize,
        finalTopK: options?.finalTopK ?? configured.finalTopK,
        denseCandidateK: Math.min(options?.poolSize ?? configured.poolSize, configured.denseCandidateK),
        bm25CandidateK: Math.min(options?.poolSize ?? configured.poolSize, configured.bm25CandidateK),
    };
}
function logRetrievalSkipped(logger, executor, reason) {
    (0, request_observability_1.logDebug)('RETRIEVAL_DECISION', {
        executor,
        retrieval: 'skipped',
        reason,
    });
}
function logRetrievalProfile(logger, executor, parameters) {
    (0, request_observability_1.logDebug)('RETRIEVAL_DECISION', {
        executor: executor ?? 'unknown',
        retrievalProfile: parameters.profile,
        densePool: parameters.poolSize,
        bm25Pool: parameters.bm25CandidateK,
        finalTopK: parameters.finalTopK,
        ...(parameters.geminiRerank ? { geminiRerank: true } : {}),
    });
}
//# sourceMappingURL=retrieval-profile.js.map