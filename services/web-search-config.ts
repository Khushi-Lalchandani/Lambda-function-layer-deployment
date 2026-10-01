import { isGeminiConfigured } from './gemini-provider';
import { getLlmGateway } from './llm-gateway.service';
import * as fs from 'fs';
import * as path from 'path';
import {
  LEGAL_ANSWER_GENERATION_THINKING_LEVEL,
  LEGAL_MODEL_TEMPERATURE,
  TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK,
  TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY,
  TIER_MODEL_LEGAL_ANSWER_GENERATION,
  TIER_MODEL_SUFFICIENCY_FALLBACK,
  TIER_MODEL_SUFFICIENCY_PRIMARY,
  TIER_MODEL_WEB_GROUNDING_ESCALATE,
  TIER_MODEL_WEB_GROUNDING_FALLBACK,
  TIER_MODEL_WEB_GROUNDING_PRIMARY,
} from './web-search-tier.constants';

export interface WebSearchConfigInterface {
  enabled: boolean;
  cache_enabled: boolean;
  cache_ttl_seconds: number;
  min_chunks_threshold: number;
  min_chunk_length: number;
  legal_keywords: string[];
  gemini_temperature: number;
  gemini_top_p: number;
  gemini_top_k: number;
  require_legal_domain: boolean;
  allowed_domains: string[];
  sufficiency_normal_similarity_threshold: number;
  sufficiency_completeness_similarity_threshold: number;
  model_sufficiency_primary: string;
  model_sufficiency_fallback: string;
  model_web_grounding_primary: string;
  model_web_grounding_fallback: string;
  model_web_grounding_escalate: string;
  model_hybrid_synthesis_primary: string;
  model_hybrid_synthesis_fallback: string;
  model_legal_answer_generation: string;
  legal_model_temperature: number;
  legal_answer_thinking_level: string;
}

export class WebSearchConfig {
  private readonly promptCache = new Map<string, string>();
  private readonly promptDirectories = [
    path.resolve(process.cwd(), 'prompts'),
    path.resolve(process.cwd(), 'dist', 'prompts'),
    path.resolve(__dirname, '..', 'prompts'),
  ];
  enabled = this.parseBoolean(process.env.WEB_SEARCH_ENABLED, true);
  cache_enabled = this.parseBoolean(
    process.env.WEB_SEARCH_CACHE_ENABLED,
    true,
  );
  cache_ttl_seconds = parseInt(
    process.env.WEB_SEARCH_CACHE_TTL_SECONDS || '3600',
  );
  min_chunks_threshold = parseInt(
    process.env.WEB_SEARCH_MIN_CHUNKS_THRESHOLD || '2',
  );
  min_chunk_length = parseInt(process.env.WEB_SEARCH_MIN_CHUNK_LENGTH || '500');
  legal_keywords = [
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
  gemini_temperature = parseFloat(
    process.env.WEB_SEARCH_GEMINI_TEMPERATURE || '0.6',
  );
  gemini_top_p = parseFloat(process.env.WEB_SEARCH_GEMINI_TOP_P || '0.95');
  gemini_top_k = parseInt(process.env.WEB_SEARCH_GEMINI_TOP_K || '40');
  // IMPORTANT:
  // By default, web search is ONLY allowed for legal-domain queries.
  // Non-legal/general questions (e.g. "What is the capital of India?")
  // must NOT be answered via web search and should fall back to
  // a conservative "out of scope" response instead.
  require_legal_domain = this.parseBoolean(
    process.env.WEB_SEARCH_REQUIRE_LEGAL_DOMAIN,
    true,
  );
  allowed_domains = process.env.WEB_SEARCH_ALLOWED_DOMAINS
    ? process.env.WEB_SEARCH_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
    : [];
  sufficiency_normal_similarity_threshold = parseFloat(
    process.env.SUFFICIENCY_NORMAL_SIMILARITY_THRESHOLD || '0.4',
  );
  sufficiency_completeness_similarity_threshold = parseFloat(
    process.env.SUFFICIENCY_COMPLETENESS_SIMILARITY_THRESHOLD || '0.5',
  );
  model_sufficiency_primary =
    process.env.WEB_SEARCH_MODEL_SUFFICIENCY_PRIMARY ??
    TIER_MODEL_SUFFICIENCY_PRIMARY;
  model_sufficiency_fallback =
    process.env.WEB_SEARCH_MODEL_SUFFICIENCY_FALLBACK ??
    TIER_MODEL_SUFFICIENCY_FALLBACK;
  model_web_grounding_primary =
    process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_PRIMARY ??
    TIER_MODEL_WEB_GROUNDING_PRIMARY;
  model_web_grounding_fallback =
    process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_FALLBACK ??
    TIER_MODEL_WEB_GROUNDING_FALLBACK;
  model_web_grounding_escalate =
    process.env.WEB_SEARCH_MODEL_WEB_GROUNDING_ESCALATE ??
    TIER_MODEL_WEB_GROUNDING_ESCALATE;
  model_hybrid_synthesis_primary =
    process.env.WEB_SEARCH_MODEL_HYBRID_SYNTHESIS_PRIMARY ??
    TIER_MODEL_HYBRID_SYNTHESIS_PRIMARY;
  model_hybrid_synthesis_fallback =
    process.env.WEB_SEARCH_MODEL_HYBRID_SYNTHESIS_FALLBACK ??
    TIER_MODEL_HYBRID_SYNTHESIS_FALLBACK;
  model_legal_answer_generation =
    process.env.WEB_SEARCH_MODEL_LEGAL_ANSWER_GENERATION ??
    TIER_MODEL_LEGAL_ANSWER_GENERATION;
  legal_answer_thinking_level =
    process.env.WEB_SEARCH_LEGAL_ANSWER_THINKING_LEVEL ??
    LEGAL_ANSWER_GENERATION_THINKING_LEVEL;
  legal_model_temperature = parseFloat(
    process.env.WEB_SEARCH_LEGAL_MODEL_TEMPERATURE ??
      String(LEGAL_MODEL_TEMPERATURE),
  );
  /** TEMPORARY: set WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION=true to A/B compare old vs new static prompt block. Remove after manual verification. */
  legacy_language_instruction = this.parseBoolean(
    process.env.WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION,
    false,
  );

  private parseBoolean(
    envValue: string | undefined,
    defaultValue: boolean,
  ): boolean {
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

  async isLegalQuery(query: string): Promise<boolean> {
    try {
      // Try AI-based detection first
      if (!isGeminiConfigured()) {
        return this._fallbackLegalQueryDetection(query);
      }

      const llm = getLlmGateway();

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
    } catch (error) {
      // On any error, fall back to keyword-based detection
      return this._fallbackLegalQueryDetection(query);
    }
  }

  /**
   * Robustly extracts text from Gemini API response, handling multiple response formats
   */
  private _extractTextFromResponse(response: any): string {
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
              const textParts: string[] = [];
              for (const part of content.parts) {
                if (part && typeof part === 'object' && 'text' in part) {
                  textParts.push(part.text);
                } else if (typeof part === 'string') {
                  textParts.push(part);
                }
              }
              return textParts.join(' ').trim();
            } else if (typeof content === 'string') {
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
    } catch (error) {
      // If extraction fails, return empty string to trigger fallback
      return '';
    }
  }

  private _fallbackLegalQueryDetection(query: string): boolean {
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

  private getPromptTemplate(fileName: string): string {
    const cachedTemplate = this.promptCache.get(fileName);
    if (cachedTemplate != null) {
      return cachedTemplate;
    }

    const filePath =
      this.promptDirectories
        .map((promptDirectory) => path.resolve(promptDirectory, fileName))
        .find((resolvedPath) => fs.existsSync(resolvedPath)) ?? '';

    if (!filePath) {
      throw new Error(`Prompt template not found: ${fileName}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    this.promptCache.set(fileName, fileContent);
    return fileContent;
  }

  toDict(): WebSearchConfigInterface {
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
      sufficiency_normal_similarity_threshold:
        this.sufficiency_normal_similarity_threshold,
      sufficiency_completeness_similarity_threshold:
        this.sufficiency_completeness_similarity_threshold,
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

export const webSearchConfig = new WebSearchConfig();
