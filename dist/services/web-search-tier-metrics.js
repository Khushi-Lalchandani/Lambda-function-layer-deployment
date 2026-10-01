"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSearchTierMetricsStore = void 0;
exports.getWebSearchTierMetrics = getWebSearchTierMetrics;
exports.resetWebSearchTierMetrics = resetWebSearchTierMetrics;
exports.extractSourceCitations = extractSourceCitations;
exports.computeCitationPreservationRate = computeCitationPreservationRate;
exports.extractMarkdownTables = extractMarkdownTables;
exports.computeTablePreservationRate = computeTablePreservationRate;
exports.measureHybridAnswerQuality = measureHybridAnswerQuality;
const common_1 = require("@nestjs/common");
const metricsLogger = new common_1.Logger('WebSearchTierMetrics');
const MAX_RECORDS = 5000;
let metricsInstance = null;
function getWebSearchTierMetrics() {
    if (!metricsInstance) {
        metricsInstance = new WebSearchTierMetricsStore();
    }
    return metricsInstance;
}
function resetWebSearchTierMetrics() {
    metricsInstance = null;
}
function extractSourceCitations(text) {
    const matches = text.match(/\[Source:\s*([^\]]+)\]/gi) ?? [];
    return [
        ...new Set(matches.map((match) => {
            const inner = match.replace(/^\[Source:\s*/i, '').replace(/\]$/, '');
            return inner.trim();
        })),
    ].filter(Boolean);
}
function computeCitationPreservationRate(expectedSources, answer) {
    const uniqueExpected = [...new Set(expectedSources.filter(Boolean))];
    if (!uniqueExpected.length) {
        return {
            citationPreservationRate: 1,
            citationsExpected: 0,
            citationsPreserved: 0,
        };
    }
    const answerLower = answer.toLowerCase();
    const preserved = uniqueExpected.filter((source) => answerLower.includes(source.toLowerCase()));
    return {
        citationsExpected: uniqueExpected.length,
        citationsPreserved: preserved.length,
        citationPreservationRate: preserved.length / uniqueExpected.length,
    };
}
const MARKDOWN_TABLE_ROW = /^\s*\|?.+\|.+\|?\s*$/;
function extractMarkdownTables(text) {
    const lines = text.split('\n');
    const tables = [];
    let current = [];
    const flush = () => {
        if (current.length >= 2) {
            tables.push(current.join('\n'));
        }
        current = [];
    };
    for (const line of lines) {
        if (MARKDOWN_TABLE_ROW.test(line) && line.includes('|')) {
            current.push(line);
        }
        else {
            flush();
        }
    }
    flush();
    return tables;
}
function computeTablePreservationRate(inputText, answer) {
    const tables = extractMarkdownTables(inputText);
    if (!tables.length) {
        return {
            tablePreservationRate: 1,
            tablesExpected: 0,
            tablesPreserved: 0,
        };
    }
    const preserved = tables.filter((table) => {
        const headerRow = table.split('\n').find((line) => line.includes('|'));
        if (!headerRow) {
            return false;
        }
        const headerCells = headerRow
            .split('|')
            .map((cell) => cell.trim())
            .filter(Boolean);
        return headerCells.every((cell) => answer.toLowerCase().includes(cell.toLowerCase()));
    });
    return {
        tablesExpected: tables.length,
        tablesPreserved: preserved.length,
        tablePreservationRate: preserved.length / tables.length,
    };
}
function measureHybridAnswerQuality(documentContext, answer) {
    const citations = computeCitationPreservationRate(extractSourceCitations(documentContext), answer);
    const tables = computeTablePreservationRate(documentContext, answer);
    return {
        ...citations,
        ...tables,
        answerLength: answer.length,
    };
}
function percentile(sorted, p) {
    if (!sorted.length) {
        return null;
    }
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}
class WebSearchTierMetricsStore {
    constructor() {
        this.latencyRecords = [];
        this.hybridQualityRecords = [];
    }
    recordTierLatency(tier, latencyMs, model, status) {
        this.latencyRecords.push({
            tier,
            latencyMs,
            model,
            status,
            timestamp: new Date().toISOString(),
        });
        if (this.latencyRecords.length > MAX_RECORDS) {
            this.latencyRecords.splice(0, this.latencyRecords.length - MAX_RECORDS);
        }
    }
    recordHybridQuality(documentContext, answer, meta) {
        const metrics = measureHybridAnswerQuality(documentContext, answer);
        this.hybridQualityRecords.push({
            ...metrics,
            timestamp: new Date().toISOString(),
        });
        if (this.hybridQualityRecords.length > MAX_RECORDS) {
            this.hybridQualityRecords.splice(0, this.hybridQualityRecords.length - MAX_RECORDS);
        }
        metricsLogger.log(`[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
            event: 'hybrid_answer_quality',
            query: meta?.query?.slice(0, 120),
            model: meta?.model,
            ...metrics,
        })}`);
        return metrics;
    }
    getTierPercentiles(tier, status = 'success') {
        const latencies = this.latencyRecords
            .filter((record) => record.tier === tier && record.status === status)
            .map((record) => record.latencyMs)
            .sort((a, b) => a - b);
        return {
            p50: percentile(latencies, 50),
            p95: percentile(latencies, 95),
            sampleCount: latencies.length,
        };
    }
    getHybridQualitySummary() {
        if (!this.hybridQualityRecords.length) {
            return {
                sampleCount: 0,
                avgCitationPreservationRate: 0,
                avgTablePreservationRate: 0,
                avgAnswerLength: 0,
            };
        }
        const count = this.hybridQualityRecords.length;
        const totals = this.hybridQualityRecords.reduce((acc, record) => ({
            citation: acc.citation + record.citationPreservationRate,
            table: acc.table + record.tablePreservationRate,
            length: acc.length + record.answerLength,
        }), { citation: 0, table: 0, length: 0 });
        return {
            sampleCount: count,
            avgCitationPreservationRate: totals.citation / count,
            avgTablePreservationRate: totals.table / count,
            avgAnswerLength: totals.length / count,
        };
    }
    logTierLatencySummary() {
        const tiers = [
            'sufficiency_routing',
            'web_grounding',
            'hybrid_synthesis',
            'legal_answer_generation',
            'document_insufficiency',
        ];
        for (const tier of tiers) {
            const percentiles = this.getTierPercentiles(tier);
            metricsLogger.log(`[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
                event: 'tier_latency_summary',
                tier,
                p50Ms: percentiles.p50,
                p95Ms: percentiles.p95,
                sampleCount: percentiles.sampleCount,
            })}`);
        }
        const quality = this.getHybridQualitySummary();
        metricsLogger.log(`[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
            event: 'hybrid_quality_summary',
            ...quality,
        })}`);
    }
}
exports.WebSearchTierMetricsStore = WebSearchTierMetricsStore;
//# sourceMappingURL=web-search-tier-metrics.js.map