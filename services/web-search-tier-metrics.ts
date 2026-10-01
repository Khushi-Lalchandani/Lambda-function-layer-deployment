import { Logger } from '@nestjs/common';

export type WebSearchTier =
  | 'sufficiency_routing'
  | 'web_grounding'
  | 'hybrid_synthesis'
  | 'legal_answer_generation'
  | 'document_insufficiency';

export type TierLatencyStatus = 'success' | 'failed';

export interface TierLatencyRecord {
  tier: WebSearchTier;
  latencyMs: number;
  model: string;
  status: TierLatencyStatus;
  timestamp: string;
}

export interface TierPercentiles {
  p50: number | null;
  p95: number | null;
  sampleCount: number;
}

export interface HybridQualityMetrics {
  citationPreservationRate: number;
  citationsExpected: number;
  citationsPreserved: number;
  tablePreservationRate: number;
  tablesExpected: number;
  tablesPreserved: number;
  answerLength: number;
}

const metricsLogger = new Logger('WebSearchTierMetrics');
const MAX_RECORDS = 5000;

let metricsInstance: WebSearchTierMetricsStore | null = null;

export function getWebSearchTierMetrics(): WebSearchTierMetricsStore {
  if (!metricsInstance) {
    metricsInstance = new WebSearchTierMetricsStore();
  }
  return metricsInstance;
}

export function resetWebSearchTierMetrics(): void {
  metricsInstance = null;
}

export function extractSourceCitations(text: string): string[] {
  const matches = text.match(/\[Source:\s*([^\]]+)\]/gi) ?? [];
  return [
    ...new Set(
      matches.map((match) => {
        const inner = match.replace(/^\[Source:\s*/i, '').replace(/\]$/, '');
        return inner.trim();
      }),
    ),
  ].filter(Boolean);
}

export function computeCitationPreservationRate(
  expectedSources: string[],
  answer: string,
): Pick<
  HybridQualityMetrics,
  'citationPreservationRate' | 'citationsExpected' | 'citationsPreserved'
> {
  const uniqueExpected = [...new Set(expectedSources.filter(Boolean))];
  if (!uniqueExpected.length) {
    return {
      citationPreservationRate: 1,
      citationsExpected: 0,
      citationsPreserved: 0,
    };
  }

  const answerLower = answer.toLowerCase();
  const preserved = uniqueExpected.filter((source) =>
    answerLower.includes(source.toLowerCase()),
  );

  return {
    citationsExpected: uniqueExpected.length,
    citationsPreserved: preserved.length,
    citationPreservationRate: preserved.length / uniqueExpected.length,
  };
}

const MARKDOWN_TABLE_ROW = /^\s*\|?.+\|.+\|?\s*$/;

export function extractMarkdownTables(text: string): string[] {
  const lines = text.split('\n');
  const tables: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length >= 2) {
      tables.push(current.join('\n'));
    }
    current = [];
  };

  for (const line of lines) {
    if (MARKDOWN_TABLE_ROW.test(line) && line.includes('|')) {
      current.push(line);
    } else {
      flush();
    }
  }
  flush();

  return tables;
}

export function computeTablePreservationRate(
  inputText: string,
  answer: string,
): Pick<
  HybridQualityMetrics,
  'tablePreservationRate' | 'tablesExpected' | 'tablesPreserved'
> {
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
    return headerCells.every((cell) =>
      answer.toLowerCase().includes(cell.toLowerCase()),
    );
  });

  return {
    tablesExpected: tables.length,
    tablesPreserved: preserved.length,
    tablePreservationRate: preserved.length / tables.length,
  };
}

export function measureHybridAnswerQuality(
  documentContext: string,
  answer: string,
): HybridQualityMetrics {
  const citations = computeCitationPreservationRate(
    extractSourceCitations(documentContext),
    answer,
  );
  const tables = computeTablePreservationRate(documentContext, answer);

  return {
    ...citations,
    ...tables,
    answerLength: answer.length,
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) {
    return null;
  }
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}

export class WebSearchTierMetricsStore {
  private readonly latencyRecords: TierLatencyRecord[] = [];
  private readonly hybridQualityRecords: Array<
    HybridQualityMetrics & { timestamp: string }
  > = [];

  recordTierLatency(
    tier: WebSearchTier,
    latencyMs: number,
    model: string,
    status: TierLatencyStatus,
  ): void {
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

  recordHybridQuality(
    documentContext: string,
    answer: string,
    meta?: { query?: string; model?: string },
  ): HybridQualityMetrics {
    const metrics = measureHybridAnswerQuality(documentContext, answer);
    this.hybridQualityRecords.push({
      ...metrics,
      timestamp: new Date().toISOString(),
    });
    if (this.hybridQualityRecords.length > MAX_RECORDS) {
      this.hybridQualityRecords.splice(
        0,
        this.hybridQualityRecords.length - MAX_RECORDS,
      );
    }

    metricsLogger.log(
      `[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
        event: 'hybrid_answer_quality',
        query: meta?.query?.slice(0, 120),
        model: meta?.model,
        ...metrics,
      })}`,
    );

    return metrics;
  }

  getTierPercentiles(
    tier: WebSearchTier,
    status: TierLatencyStatus = 'success',
  ): TierPercentiles {
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

  getHybridQualitySummary(): {
    sampleCount: number;
    avgCitationPreservationRate: number;
    avgTablePreservationRate: number;
    avgAnswerLength: number;
  } {
    if (!this.hybridQualityRecords.length) {
      return {
        sampleCount: 0,
        avgCitationPreservationRate: 0,
        avgTablePreservationRate: 0,
        avgAnswerLength: 0,
      };
    }

    const count = this.hybridQualityRecords.length;
    const totals = this.hybridQualityRecords.reduce(
      (acc, record) => ({
        citation: acc.citation + record.citationPreservationRate,
        table: acc.table + record.tablePreservationRate,
        length: acc.length + record.answerLength,
      }),
      { citation: 0, table: 0, length: 0 },
    );

    return {
      sampleCount: count,
      avgCitationPreservationRate: totals.citation / count,
      avgTablePreservationRate: totals.table / count,
      avgAnswerLength: totals.length / count,
    };
  }

  logTierLatencySummary(): void {
    const tiers: WebSearchTier[] = [
      'sufficiency_routing',
      'web_grounding',
      'hybrid_synthesis',
      'legal_answer_generation',
      'document_insufficiency',
    ];

    for (const tier of tiers) {
      const percentiles = this.getTierPercentiles(tier);
      metricsLogger.log(
        `[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
          event: 'tier_latency_summary',
          tier,
          p50Ms: percentiles.p50,
          p95Ms: percentiles.p95,
          sampleCount: percentiles.sampleCount,
        })}`,
      );
    }

    const quality = this.getHybridQualitySummary();
    metricsLogger.log(
      `[WEB_SEARCH_TIER_METRICS] ${JSON.stringify({
        event: 'hybrid_quality_summary',
        ...quality,
      })}`,
    );
  }
}
