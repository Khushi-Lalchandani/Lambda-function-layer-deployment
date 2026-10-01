/**
 * Benchmark hybrid retrieval timing for REASONING-intent queries.
 *
 * Required env:
 *   OPENAI_KEY
 *   SIMPLCASE_SERVICE_ACC_JSON
 *   BACKEND_URL
 *   BENCHMARK_DOCUMENT_IDS  (comma-separated UUIDs)
 *
 * Optional:
 *   BENCHMARK_FILE_NAME
 *
 * Usage: npm run build && node scripts/benchmark-retrieval.js
 */
const { Logger } = require('@nestjs/common');
const { BackendService } = require('../dist/services/backend.service');
const { HybridRetrievalService } = require('../dist/services/hybrid-retrieval.service');
const { ChunkRerankService } = require('../dist/services/chunk-rerank.service');
const { PromptTemplateService } = require('../dist/services/prompt-template.service');

const REASONING_QUERIES = [
  'Explain the allegations in detail and how they relate to the contract terms.',
  'What are the legal implications of the breach described in the notice?',
  'Summarize the defendant arguments and the supporting evidence cited.',
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseRetrievalTimings(logMessage) {
  const fields = ['denseMs', 'bm25Ms', 'mergeMs', 'rerankMs', 'latencyMs'];
  const timings = {};
  for (const field of fields) {
    const match = logMessage.match(new RegExp(`${field}=(\\d+)`));
    timings[field] = match ? Number(match[1]) : null;
  }
  return timings;
}

async function main() {
  requireEnv('OPENAI_KEY');
  requireEnv('SIMPLCASE_SERVICE_ACC_JSON');
  requireEnv('BACKEND_URL');
  const documentIds = requireEnv('BENCHMARK_DOCUMENT_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (!documentIds.length) {
    throw new Error('BENCHMARK_DOCUMENT_IDS must include at least one document ID');
  }

  const fileName = process.env.BENCHMARK_FILE_NAME?.trim() || undefined;
  const backendService = new BackendService();
  const promptTemplateService = new PromptTemplateService();
  const chunkRerankService = new ChunkRerankService(promptTemplateService);
  const hybridRetrievalService = new HybridRetrievalService(
    backendService,
    chunkRerankService,
  );

  const capturedLogs = [];
  const logger = hybridRetrievalService['logger'];
  const originalLog = logger.log.bind(logger);
  logger.log = (message, ...args) => {
    if (
      typeof message === 'string' &&
      message.includes('[DEBUG_PIPELINE][RETRIEVAL_RESULT]')
    ) {
      capturedLogs.push(message);
    }
    return originalLog(message, ...args);
  };

  console.log(
    `Benchmarking ${REASONING_QUERIES.length} REASONING queries against ${documentIds.length} document(s)...`,
  );

  const results = [];
  for (const query of REASONING_QUERIES) {
    capturedLogs.length = 0;
    const chunks = await hybridRetrievalService.retrieveRankedChunks(
      query,
      documentIds,
      fileName,
      { profile: 'deep', executor: 'DocumentFirstExecutor' },
    );
    const logLine = capturedLogs.at(-1) ?? '';
    const timings = parseRetrievalTimings(logLine);
    results.push({ query, chunkCount: chunks.length, timings, logLine });
    console.log(`\nQuery: ${query}`);
    console.log(`  chunks=${chunks.length}`);
    console.log(
      `  denseMs=${timings.denseMs} bm25Ms=${timings.bm25Ms} mergeMs=${timings.mergeMs} rerankMs=${timings.rerankMs} latencyMs=${timings.latencyMs}`,
    );
  }

  const avg = (field) => {
    const values = results
      .map((row) => row.timings[field])
      .filter((value) => typeof value === 'number');
    if (!values.length) {
      return null;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  };

  console.log('\n--- Averages ---');
  console.log(
    `denseMs=${avg('denseMs')} bm25Ms=${avg('bm25Ms')} mergeMs=${avg('mergeMs')} rerankMs=${avg('rerankMs')} latencyMs=${avg('latencyMs')}`,
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
