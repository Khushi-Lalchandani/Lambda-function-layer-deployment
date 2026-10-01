"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEB_FIRST_PROBE_MIN_CHUNKS = exports.WEB_FIRST_PROBE_SIMILARITY_THRESHOLD = exports.WEB_FIRST_PROBE_TOP_K = void 0;
exports.WEB_FIRST_PROBE_TOP_K = parseInt(process.env.WEB_FIRST_PROBE_TOP_K ?? '3', 10);
exports.WEB_FIRST_PROBE_SIMILARITY_THRESHOLD = parseFloat(process.env.WEB_FIRST_PROBE_SIMILARITY_THRESHOLD ?? '0.4');
exports.WEB_FIRST_PROBE_MIN_CHUNKS = parseInt(process.env.WEB_FIRST_PROBE_MIN_CHUNKS ?? '2', 10);
//# sourceMappingURL=web-first-probe.config.js.map