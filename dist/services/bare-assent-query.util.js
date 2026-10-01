"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBareAssentQuery = isBareAssentQuery;
/** Matches bare affirmative follow-ups with no other substantive content. */
function isBareAssentQuery(query) {
    const trimmed = (query ?? '').trim();
    if (!trimmed) {
        return false;
    }
    return /^(?:yes|yeah|yep|ok|okay|sure|go ahead|please do|please|affirmative)(?:\s+please)?\s*[!.?]*$/i.test(trimmed);
}
//# sourceMappingURL=bare-assent-query.util.js.map