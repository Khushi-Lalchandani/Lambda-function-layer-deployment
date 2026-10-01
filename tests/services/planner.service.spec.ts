import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlannerService } from '../../services/planner.service';
import { PromptTemplateService } from '../../services/prompt-template.service';
import { PlannerTool } from '../../types/planner.interface';
import { ChatMessage } from '../../types/chat.interface';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

function buildToolResponse(
  toolCalls: Array<{ tool: PlannerTool; query: string; reason?: string }>,
) {
  return {
    choices: [
      {
        message: {
          tool_calls: toolCalls.map((toolCall, index) => ({
            id: `call_${index}`,
            type: 'function',
            function: {
              name: toolCall.tool,
              arguments: JSON.stringify({
                query: toolCall.query,
                reason: toolCall.reason,
              }),
            },
          })),
        },
      },
    ],
  };
}

describe('PlannerService', () => {
  let service: PlannerService;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_KEY = 'test-key';
    service = new PlannerService(new PromptTemplateService());
  });

  const cases: Array<{ input: string; tool: PlannerTool }> = [
    { input: 'Hi', tool: 'GREETING' },
    { input: 'Show chronology of the case.', tool: 'CASE_TIMELINE' },
    {
      input: 'What allegations were made against the assessee?',
      tool: 'DOCUMENT_FIRST',
    },
    { input: 'Summarize the notice.', tool: 'CASE_SUMMARY' },
    { input: 'Explain Section 148A.', tool: 'WEB_FIRST' },
    { input: 'Who won the FIFA World Cup?', tool: 'REFUSE' },
  ];

  it.each(cases)('plans $tool for "$input"', async ({ input, tool }) => {
    mockCreate.mockResolvedValue(
      buildToolResponse([{ tool, query: input }]),
    );

    const result = await service.plan(input, input);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].tool).toBe(tool);
    expect(result.actions[0].query).toBe(input);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: 'required',
        temperature: 0,
      }),
    );
  });

  it('forces DOCUMENT_FIRST for platform starter questions without calling the LLM', async () => {
    const input = 'Classify each and every document';
    const result = await service.plan(input, input);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].tool).toBe('DOCUMENT_FIRST');
    expect(result.actions[0].query).toBe(input);
    expect(result.confidence).toBe('high');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('downgrades section-scoped summary requests to DOCUMENT_FIRST', async () => {
    const input =
      "Summarize Section 8 under the 'Order under clause (d) of section 148A of the Income-tax Act, 1961' in the document.";
    mockCreate.mockResolvedValue(
      buildToolResponse([{ tool: 'CASE_SUMMARY', query: input }]),
    );

    const result = await service.plan(input, input);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].tool).toBe('DOCUMENT_FIRST');
    expect(result.actions[0].query).toBe(input);
    expect(result.actions[0].reason).toContain('document retrieval');
  });

  it('plans mixed intent with multiple tool calls', async () => {
    const input = 'Summarize the notice and explain Section 148A.';
    mockCreate.mockResolvedValue(
      buildToolResponse([
        { tool: 'CASE_SUMMARY', query: 'Summarize the notice.' },
        { tool: 'WEB_FIRST', query: 'Explain Section 148A.' },
      ]),
    );

    const result = await service.plan(input, input);

    expect(result.actions).toHaveLength(2);
    expect(result.actions.map((action) => action.tool)).toEqual([
      'CASE_SUMMARY',
      'WEB_FIRST',
    ]);
    expect(result.confidence).toBe('medium');
  });

  it('rejects GREETING for bare assent when conversation history exists', async () => {
    const history: ChatMessage[] = [
      {
        role: 'assistant',
        content:
          'Would you like me to elaborate on how the allegations relate to Section 68?',
      },
    ];

    mockCreate.mockResolvedValue(
      buildToolResponse([
        {
          tool: 'GREETING',
          query: 'yes',
          reason: 'Short message',
        },
      ]),
    );

    const result = await service.plan('yes', 'yes', history);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].tool).toBe('DOCUMENT_FIRST');
  });

  it('builds comparison against existing routing', () => {
    const comparison = service.buildComparison(
      'Show chronology of the case.',
      'metadata',
      [
        {
          originalQuery: 'Show chronology of the case.',
          subQuery: 'Show chronology of the case.',
          actions: [
            { tool: 'CASE_TIMELINE', query: 'Show chronology of the case.' },
          ],
          confidence: 'high',
        },
      ],
    );

    expect(comparison.matched).toBe(true);
    expect(comparison.existingStrategy).toBe('metadata');
  });
});
