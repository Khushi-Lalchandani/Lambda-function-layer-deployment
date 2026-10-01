import { ExistingStrategy, PlannerAction, PlannerComparisonResult, PlannerTool } from '../types/planner.interface';
export declare function mapPlannerToolToStrategy(tool: PlannerTool): ExistingStrategy;
export declare function mapPlannerActionsToStrategies(actions: PlannerAction[]): string[];
export declare function comparePlannerWithExisting(query: string, existingStrategy: string, actions: PlannerAction[]): PlannerComparisonResult;
export declare function strategiesMatch(existingStrategy: string, mappedStrategies: string[]): boolean;
//# sourceMappingURL=planner-strategy-mapper.d.ts.map