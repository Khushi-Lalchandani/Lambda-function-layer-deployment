import OpenAI from 'openai';
import { PlannerTool } from '../types/planner.interface';
export declare function buildPlannerTools(): OpenAI.Chat.Completions.ChatCompletionTool[];
export declare function isPlannerToolName(value: string): value is PlannerTool;
//# sourceMappingURL=planner-tools.d.ts.map