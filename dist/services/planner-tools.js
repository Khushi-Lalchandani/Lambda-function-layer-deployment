"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlannerTools = buildPlannerTools;
exports.isPlannerToolName = isPlannerToolName;
const PLANNER_TOOL_NAMES = [
    'GREETING',
    'CASE_TIMELINE',
    'CASE_SUMMARY',
    'DOCUMENT_FIRST',
    'WEB_FIRST',
    'REFUSE',
];
const TOOL_DESCRIPTIONS = {
    GREETING: 'Pure small talk with no legal question embedded, such as hi, hello, thanks. Do not select if any legal task is present alongside the greeting.',
    CASE_TIMELINE: 'Select ONLY when the user explicitly wants the chronology itself delivered as the final output (e.g., "give me the timeline", "list events in order"). Do NOT select merely because dates, timelines, or procedural events are mentioned — if chronology is being used as evidence for a comparison, analysis, or compliance judgment, use DOCUMENT_FIRST instead.',
    CASE_SUMMARY: 'Select ONLY when a whole-case or whole-document summary/overview is the requested final output (e.g., "summarize this case"). Do NOT select for section-, paragraph-, clause-, item-, point-, annexure-, or heading-specific summaries; those are DOCUMENT_FIRST. Do NOT select if the summary is a step toward a different judgment (e.g., "summarize and tell me if X complied" is DOCUMENT_FIRST, not CASE_SUMMARY).',
    DOCUMENT_FIRST: 'Primary evidence path — default for this assistant. Assume DOCUMENT_FIRST unless the answer would remain substantially the same even if uploaded documents did not exist. Select for case facts, notices, parties, assessment years, mixed general-law + case-application questions, and definition requests that may relate to uploaded documents. Legal terminology or statute references alone do not require WEB_FIRST. Web supplements later via sufficiency if documents are incomplete.',
    WEB_FIRST: 'Select ONLY when the answer would remain substantially the same even if uploaded documents did not exist — standalone statutory lookups or general procedure with zero case-specific facts and no plausible relevance from uploaded documents. Definitions, legal terms, or statute citations in a query do not automatically require WEB_FIRST. When uncertain, prefer DOCUMENT_FIRST.',
    REFUSE: 'Select only for questions clearly unrelated to Indian tax law or general legal procedure, such as sports or geography trivia. Do not select for general Indian legal-procedure questions (e.g., writ vs appeal) — those are WEB_FIRST.',
};
function buildPlannerTools() {
    return PLANNER_TOOL_NAMES.map((toolName) => ({
        type: 'function',
        function: {
            name: toolName,
            description: TOOL_DESCRIPTIONS[toolName],
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The specific sub-query or user question this tool should handle.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Brief reason for selecting this capability.',
                    },
                },
                required: ['query', 'reason'],
                additionalProperties: false,
            },
        },
    }));
}
function isPlannerToolName(value) {
    return PLANNER_TOOL_NAMES.includes(value);
}
//# sourceMappingURL=planner-tools.js.map