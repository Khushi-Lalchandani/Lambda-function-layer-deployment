"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.webSearchConfig = exports.WebSearchConfig = void 0;
const gemini_provider_1 = require("./gemini-provider");
const llm_gateway_service_1 = require("./llm-gateway.service");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const web_search_tier_constants_1 = require("./web-search-tier.constants");
class WebSearchConfig {
    constructor() {
        this.promptCache = new Map();
        this.promptDirectories = [
            path.resolve(process.cwd(), 'prompts'),
            path.resolve(process.cwd(), 'dist', 'prompts'),
            path.resolve(__dirname, '..', 'prompts'),
        ];
        this.enabled = this.parseBoolean(process.env.WEB_SEARCH_ENABLED, true);
        this.cache_enabled = this.parseBoolean(process.env.WEB_SEARCH_CACHE_ENABLED, true);
        this.cache_ttl_seconds = parseInt(process.env.WEB_SEARCH_CACHE_TTL_SECONDS || '3600');
        this.min_chunks_threshold = parseInt(process.env.WEB_SEARCH_MIN_CHUNKS_THRESHOLD || '2');
        this.min_chunk_length = parseInt(process.env.WEB_SEARCH_MIN_CHUNK_LENGTH || '500');
        this.legal_keywords = [
            'ipc section',
            'section',
            'act',
            'law',
            'legal provision',
            'court rule',
            'procedure',
            'jurisdiction',
            'statute',
            'penal code',
            'civil procedure',
            'criminal procedure',
            'evidence act',
            'criminal law',
            'civil law',
            'constitutional law',
            'administrative law',
        ];
        this.gemini_temperature = parseFloat(process.env.WEB_SEARCH_GEMINI_TEMPERATURE || '0.6');
        this.gemini_top_p = parseFloat(process.env.WEB_SEARCH_GEMINI_TOP_P || '0.95');
        this.gemini_top_k = parseInt(process.env.WEB_SEARCH_GEMINI_TOP_K || '40');
        // IMPORTANT:
        // By default, web search is ONLY allowed for legal-domain queries.
        // Non-legal/general questions (e.g. "What is the capital of India?")
        // must NOT be answered via web search and should fall back to
        // a conservative "out of scope" response instead.
        this.require_legal_domain = this.parseBoolean(process.env.WEB_SEARCH_REQUIRE_LEGAL_DOMAIN, true);
        this.allowed_domains = process.env.WEB_SEARCH_ALLOWED_DOMAINS
            ? process.env.WEB_SEARCH_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
            : [];
        this.sufficiency_normal_similarity_threshold = parseFloat(process.env.SUFFICIENCY_NORMAL_SIMILARITY_THRESHOLD || '0.4');
        this.sufficiency_completeness_similarity_threshold = parseFloat(process.env.SUFFICIENCY_COMPLETENESS_SIMILARITY_THRESHOLD || '0.5');
        this.model_sufficiency_primary = process.env.WEB_SEARCH_MODEL_SUFFICIENCY_PRIMARY ??
            web_search_tier_constants_1.TIER_MODEL_SUFFICIENCY_PRIMARY;
        this.model_sufficiency_fallback = process.env.WEB_SEARCH_MODEL_SUFFICIENCY_FALLBACK ??
            web_search_tier_constants_1.TIER_MODEL_SUFFICIENCY_FALLBACK;
        this.model_web_grounding_primary = process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_PRIMARY ??
            web_search_tier_constants_1.TIER_MODEL_WEB_GROUNDING_PRIMARY;
        this.model_web_grounding_fallback = process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_FALLBACK ??
            web_search_tier_constants_1.TIER_MODEL_WEB_GROUNDING_FALLBACK;
        this.model_web_grounding_escalate = process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_ESCALATE ??
            web_search_tier_constants_1.TIER_MODEL_WEB_GROUNDING_ESCALATE;
        this.model_hybrid_synthesis_primary = process.env.WEB_SEARCH_MODEL_HYBRID_SYNTHESIS_PRIMARY ??
            web_search_tier_constants_1.TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY;
        this.model_hybrid_synthesis_fallback = process.env.WEB_SEARCH_MODEL_HYBRID_SYNTHESIS_FALLBACK ??
            web_search_tier_constants_1.TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK;
        this.model_legal_answer_generation = process.env.WEB_SEARCH_MODEL_LEGAL_ANSWER_GENERATION ??
            web_search_tier_constants_1.TIER_MODEL_LEGAL_ANSWER_GENERATION;
        this.legal_answer_thinking_level = process.env.WEB_SEARCH_LEGAL_ANSWER_THINKING_LEVEL ??
            web_search_tier_constants_1.LEGAL_ANSWER_GENERATION_THINKING_LEVEL;
        this.legal_model_temperature = parseFloat(process.env.WEB_SEARCH_LEGAL_MODEL_TEMPERATURE ??
            String(web_search_tier_constants_1.LEGAL_MODEL_TEMPERATURE));
        /** TEMPORARY: set WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION=true to A/B compare old vs new static prompt block. Remove after manual verification. */
        this.legacy_language_instruction = this.parseBoolean(process.env.WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION, false);
    }
    parseBoolean(envValue, defaultValue) {
        if (envValue == null) {
            return defaultValue;
        }
        const normalized = envValue.toLowerCase();
        if (normalized === 'true') {
            return true;
        }
        if (normalized === 'false') {
            return false;
        }
        return defaultValue;
    }
    async isLegalQuery(query) {
        try {
            // Try AI-based detection first
            if (!(0, gemini_provider_1.isGeminiConfigured)()) {
                return this._fallbackLegalQueryDetection(query);
            }
            const llm = (0, llm_gateway_service_1.getLlmGateway)();
            const promptTemplate = this.getPromptTemplate('legal-query-detection.txt');
            const prompt = promptTemplate.replace('{{query}}', query);
            const response = await llm.generateContent({
                model: this.model_sufficiency_fallback,
                contents: prompt,
                config: {
                    temperature: this.legal_model_temperature,
                    topP: 0.95,
                    topK: 40,
                },
            });
            // Robust text extraction with fallback
            const answer = this._extractTextFromResponse(response);
            // If text extraction failed or returned empty, fall back to keyword detection
            if (!answer || answer.trim().length === 0) {
                return this._fallbackLegalQueryDetection(query);
            }
            const normalizedAnswer = answer.trim().toLowerCase();
            const result = normalizedAnswer.startsWith('yes');
            return result;
        }
        catch (error) {
            // On any error, fall back to keyword-based detection
            return this._fallbackLegalQueryDetection(query);
        }
    }
    /**
     * Robustly extracts text from Gemini API response, handling multiple response formats
     */
    _extractTextFromResponse(response) {
        try {
            // Handle function-based text extraction
            if (response && typeof response.text === 'function') {
                return response.text().trim();
            }
            // Handle direct text property
            if (response && typeof response.text === 'string') {
                return response.text.trim();
            }
            // Handle Gemini response format with candidates
            if (response && typeof response === 'object' && 'candidates' in response) {
                const candidates = response.candidates;
                if (Array.isArray(candidates) && candidates.length > 0) {
                    const candidate = candidates[0];
                    if (candidate && 'content' in candidate) {
                        const content = candidate.content;
                        if (content && 'parts' in content && Array.isArray(content.parts)) {
                            const textParts = [];
                            for (const part of content.parts) {
                                if (part && typeof part === 'object' && 'text' in part) {
                                    textParts.push(part.text);
                                }
                                else if (typeof part === 'string') {
                                    textParts.push(part);
                                }
                            }
                            return textParts.join(' ').trim();
                        }
                        else if (typeof content === 'string') {
                            return content.trim();
                        }
                    }
                }
            }
            // Handle response.response pattern (some API versions)
            if (response && typeof response === 'object' && 'response' in response) {
                return this._extractTextFromResponse(response.response);
            }
            // Fallback: try to stringify and extract
            const stringified = String(response ?? '').trim();
            return stringified;
        }
        catch (error) {
            // If extraction fails, return empty string to trigger fallback
            return '';
        }
    }
    _fallbackLegalQueryDetection(query) {
        const q = query.toLowerCase();
        if (this.legal_keywords.some((keyword) => q.includes(keyword))) {
            return true;
        }
        const legalPatterns = [
            /\bipc\s*section\s*\d+[a-zA-Z]*\b/i,
            /\bipc\s*\d+[a-zA-Z]*\b/i,
            /\bcrpc\s*section\s*\d+[a-zA-Z]*\b/i,
            /\bcrpc\s*\d+[a-zA-Z]*\b/i,
            /\bcpc\s*section\s*\d+[a-zA-Z]*\b/i,
            /\bcpc\s*\d+[a-zA-Z]*\b/i,
            /\bsection\s*\d+[a-zA-Z]*\b/i,
            /\bevidence\s*act\b/i,
            /\bpenal\s*code\b/i,
            /\btransfer\s*of\s*property\s*act\b/i,
        ];
        return legalPatterns.some((pattern) => pattern.test(q));
    }
    getPromptTemplate(fileName) {
        const cachedTemplate = this.promptCache.get(fileName);
        if (cachedTemplate != null) {
            return cachedTemplate;
        }
        const filePath = this.promptDirectories
            .map((promptDirectory) => path.resolve(promptDirectory, fileName))
            .find((resolvedPath) => fs.existsSync(resolvedPath)) ?? '';
        if (!filePath) {
            throw new Error(`Prompt template not found: ${fileName}`);
        }
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        this.promptCache.set(fileName, fileContent);
        return fileContent;
    }
    toDict() {
        return {
            enabled: this.enabled,
            cache_enabled: this.cache_enabled,
            cache_ttl_seconds: this.cache_ttl_seconds,
            min_chunks_threshold: this.min_chunks_threshold,
            min_chunk_length: this.min_chunk_length,
            legal_keywords: this.legal_keywords,
            gemini_temperature: this.gemini_temperature,
            gemini_top_p: this.gemini_top_p,
            gemini_top_k: this.gemini_top_k,
            require_legal_domain: this.require_legal_domain,
            allowed_domains: this.allowed_domains,
            sufficiency_normal_similarity_threshold: this.sufficiency_normal_similarity_threshold,
            sufficiency_completeness_similarity_threshold: this.sufficiency_completeness_similarity_threshold,
            model_sufficiency_primary: this.model_sufficiency_primary,
            model_sufficiency_fallback: this.model_sufficiency_fallback,
            model_web_grounding_primary: this.model_web_grounding_primary,
            model_web_grounding_fallback: this.model_web_grounding_fallback,
            model_web_grounding_escalate: this.model_web_grounding_escalate,
            model_hybrid_synthesis_primary: this.model_hybrid_synthesis_primary,
            model_hybrid_synthesis_fallback: this.model_hybrid_synthesis_fallback,
            model_legal_answer_generation: this.model_legal_answer_generation,
            legal_model_temperature: this.legal_model_temperature,
            legal_answer_thinking_level: this.legal_answer_thinking_level,
        };
    }
}
exports.WebSearchConfig = WebSearchConfig;
exports.webSearchConfig = new WebSearchConfig();
//# sourceMappingURL=web-search-config.js.map