"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapPlannerToolToStrategy = mapPlannerToolToStrategy;
exports.mapPlannerActionsToStrategies = mapPlannerActionsToStrategies;
exports.comparePlannerWithExisting = comparePlannerWithExisting;
exports.strategiesMatch = strategiesMatch;
const PLANNER_TO_STRATEGY = {
    GREETING: 'greeting',
    CASE_TIMELINE: 'metadata',
    CASE_SUMMARY: 'vector',
    DOCUMENT_FIRST: 'vector',
    WEB_FIRST: 'web_search',
    REFUSE: 'conservative',
};
function mapPlannerToolToStrategy(tool) {
    return PLANNER_TO_STRATEGY[tool];
}
function mapPlannerActionsToStrategies(actions) {
    return [...new Set(actions.map((action) => mapPlannerToolToStrategy(action.tool)))];
}
function comparePlannerWithExisting(query, existingStrategy, actions) {
    const plannerActions = actions.map((action) => action.tool);
    const mappedStrategies = mapPlannerActionsToStrategies(actions);
    return {
        query,
        existingStrategy,
        plannerActions,
        mappedStrategies,
        matched: strategiesMatch(existingStrategy, mappedStrategies),
    };
}
function strategiesMatch(existingStrategy, mappedStrategies) {
    if (mappedStrategies.length === 0) {
        return false;
    }
    if (existingStrategy === 'vector + web_search') {
        return (mappedStrategies.includes('vector') &&
            mappedStrategies.includes('web_search'));
    }
    return (mappedStrategies.length === 1 && mappedStrategies[0] === existingStrategy);
}
//# sourceMappingURL=planner-strategy-mapper.js.map