"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeChunkSimilarity = normalizeChunkSimilarity;
exports.computeTopSimilarity = computeTopSimilarity;
exports.hasStrongDocumentEvidence = hasStrongDocumentEvidence;
exports.resolveWebFirstStrategy = resolveWebFirstStrategy;
const explicit_web_search_query_util_1 = require("./explicit-web-search-query.util");
const web_first_probe_config_1 = require("./web-first-probe.config");
function normalizeChunkSimilarity(distance) {
    const value = distance ?? 1;
    return Math.max(0, Math.min(1, 1 - Math.min(value / 2, 1)));
}
function computeTopSimilarity(chunks) {
    if (!chunks.length) {
        return 0;
    }
    return Math.max(...chunks.map((chunk) => normalizeChunkSimilarity(chunk.similarity)));
}
function hasStrongDocumentEvidence(chunks) {
    const topSimilarity = computeTopSimilarity(chunks);
    const chunkCount = chunks.length;
    return (topSimilarity >= web_first_probe_config_1.WEB_FIRST_PROBE_SIMILARITY_THRESHOLD &&
        chunkCount >= web_first_probe_config_1.WEB_FIRST_PROBE_MIN_CHUNKS);
}
async function resolveWebFirstStrategy(query, documentIds, fileName, hybridRetrievalService) {
    if ((0, explicit_web_search_query_util_1.isExplicitWebSearchQuery)(query)) {
        return {
            action: 'web_only',
            probe: {
                probeTriggered: true,
                topSimilarity: 0,
                chunkCount: 0,
                redirected: false,
            },
        };
    }
    if (!documentIds.length) {
        return {
            action: 'web_only',
            probe: {
                probeTriggered: true,
                topSimilarity: 0,
                chunkCount: 0,
                redirected: false,
            },
        };
    }
    const chunks = await hybridRetrievalService.retrieveRankedChunks(query, documentIds, fileName, {
        executor: 'WebFirstExecutor',
        profile: 'fast',
        finalTopK: web_first_probe_config_1.WEB_FIRST_PROBE_TOP_K,
    });
    const topSimilarity = computeTopSimilarity(chunks);
    const chunkCount = chunks.length;
    const redirected = hasStrongDocumentEvidence(chunks);
    const probe = {
        probeTriggered: true,
        topSimilarity,
        chunkCount,
        redirected,
    };
    return redirected
        ? { action: 'redirect_document_first', probe }
        : { action: 'web_only', probe };
}
//# sourceMappingURL=web-first-probe.js.map