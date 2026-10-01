import { Logger } from '@nestjs/common';
import { ChunkResult } from '../types/chat.interface';
import { QueryIntent } from './query-intent-classifier';
export type RetrievalProfile = 'fast' | 'deep';
export interface RetrievalProfileParameters {
    profile: RetrievalProfile;
    queryIntent: QueryIntent;
    poolSize: number;
    denseCandidateK: number;
    bm25CandidateK: number;
    finalTopK: number;
    geminiRerank: boolean;
}
export interface RetrievalOptions {
    finalTopK?: number;
    poolSize?: number;
    profile?: RetrievalProfile;
    executor?: string;
}
export interface ProcessVectorQueryOptions extends RetrievalOptions {
    preloadedChunks?: ChunkResult[];
}
export declare const RETRIEVAL_SKIP_REASONS: {
    readonly METADATA_ONLY: "metadata_only";
    readonly GREETING_RESPONSE: "greeting_response";
    readonly CONSERVATIVE_RESPONSE: "conservative_response";
    readonly WEB_SEARCH_ONLY: "web_search_only";
    readonly METADATA_SUMMARY_AVAILABLE: "metadata_summary_available";
};
export type RetrievalSkipReason = (typeof RETRIEVAL_SKIP_REASONS)[keyof typeof RETRIEVAL_SKIP_REASONS];
export declare function resolveRetrievalProfile(query: string, explicitProfile?: RetrievalProfile): Promise<RetrievalProfile>;
export declare function getProfileParameters(profile: RetrievalProfile): RetrievalProfileParameters;
export declare function resolveRetrievalParameters(query: string, options?: RetrievalOptions): Promise<RetrievalProfileParameters>;
export declare function logRetrievalSkipped(logger: Logger, executor: string, reason: RetrievalSkipReason): void;
export declare function logRetrievalProfile(logger: Logger, executor: string | undefined, parameters: RetrievalProfileParameters): void;
//# sourceMappingURL=retrieval-profile.d.ts.map