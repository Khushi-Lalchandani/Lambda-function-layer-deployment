"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const query_processor_1 = require("./services/query.processor");
const backend_service_1 = require("./services/backend.service");
const websocket_service_1 = require("./services/websocket.service");
const conservative_response_service_1 = require("./services/conservative-response.service");
const vector_service_1 = require("./services/vector-service");
const hybrid_retrieval_service_1 = require("./services/hybrid-retrieval.service");
const chunk_rerank_service_1 = require("./services/chunk-rerank.service");
const metadata_service_1 = require("./services/metadata.service");
const web_search_service_1 = require("./services/web-search.service");
const web_search_query_optimizer_service_1 = require("./services/web-search-query-optimizer.service");
const answer_refinement_service_1 = require("./services/answer-refinement.service");
const prompt_builder_service_1 = require("./services/prompt-builder.service");
const prompt_template_service_1 = require("./services/prompt-template.service");
const query_rewrite_service_1 = require("./services/query-rewrite.service");
const query_decomposition_service_1 = require("./services/query-decomposition.service");
const planner_service_1 = require("./services/planner.service");
const execution_graph_builder_1 = require("./services/execution-graph-builder");
const execution_graph_service_1 = require("./services/execution-graph.service");
const execution_orchestrator_service_1 = require("./services/execution-orchestrator.service");
const aggregation_service_1 = require("./services/aggregation.service");
const conversation_memory_service_1 = require("./services/conversation-memory.service");
const executor_registry_1 = require("./services/executor-registry");
const greeting_executor_1 = require("./services/executors/greeting.executor");
const timeline_executor_1 = require("./services/executors/timeline.executor");
const summary_executor_1 = require("./services/executors/summary.executor");
const document_executor_1 = require("./services/executors/document.executor");
const web_executor_1 = require("./services/executors/web.executor");
const refuse_executor_1 = require("./services/executors/refuse.executor");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const llm_gateway_service_1 = require("./services/llm-gateway.service");
let initialized = false;
let initializationPromise = null;
let backendService;
let wsService;
let queryProcessor;
const parseSecret = (secretString) => {
    try {
        return JSON.parse(secretString);
    }
    catch (error) {
        throw new Error(`Invalid Secrets Manager JSON: ${error.message}`);
    }
};
const initializeServices = async () => {
    if (initialized) {
        return;
    }
    if (initializationPromise) {
        return initializationPromise;
    }
    initializationPromise = (async () => {
        const region = process.env.SECRETS_MANAGER_REGION || 'ap-south-1';
        const secretName = process.env.SECRETS_MANAGER_NAME || 'Simplcase';
        const secretsClient = new client_secrets_manager_1.SecretsManagerClient({ region });
        const secretResponse = await secretsClient.send(new client_secrets_manager_1.GetSecretValueCommand({
            SecretId: secretName,
        }));
        if (!secretResponse.SecretString) {
            throw new Error(`Secret ${secretName} has no SecretString value`);
        }
        const secrets = parseSecret(secretResponse.SecretString);
        const openAIKey = secrets.OPENAI_KEY;
        const serviceAccountJson = secrets.SIMPLCASE_SERVICE_ACC_JSON;
        if (!openAIKey || !serviceAccountJson) {
            throw new Error(`Secret ${secretName} must include OPENAI_KEY and SIMPLCASE_SERVICE_ACC_JSON`);
        }
        process.env.OPENAI_KEY = openAIKey;
        process.env.SIMPLCASE_SERVICE_ACC_JSON = serviceAccountJson;
        (0, llm_gateway_service_1.resetLlmGateway)();
        backendService = new backend_service_1.BackendService();
        wsService = new websocket_service_1.WebSocketService();
        const promptTemplateService = new prompt_template_service_1.PromptTemplateService();
        const queryRewriteService = new query_rewrite_service_1.QueryRewriteService(promptTemplateService);
        const queryDecompositionService = new query_decomposition_service_1.QueryDecompositionService(promptTemplateService);
        const plannerService = new planner_service_1.PlannerService(promptTemplateService);
        const promptBuilderService = new prompt_builder_service_1.PromptBuilderService(promptTemplateService);
        const answerRefinementService = new answer_refinement_service_1.AnswerRefinementService(promptTemplateService);
        const conservativeResponseService = new conservative_response_service_1.ConservativeResponseService();
        const chunkRerankService = new chunk_rerank_service_1.ChunkRerankService(promptTemplateService);
        const hybridRetrievalService = new hybrid_retrieval_service_1.HybridRetrievalService(backendService, chunkRerankService);
        const vectorSearchService = new vector_service_1.VectorSearchService(backendService, hybridRetrievalService, promptBuilderService, answerRefinementService);
        const metadataService = new metadata_service_1.MetadataService(backendService, answerRefinementService, promptTemplateService);
        const webSearchQueryOptimizerService = new web_search_query_optimizer_service_1.WebSearchQueryOptimizerService(promptTemplateService);
        const webSearchService = new web_search_service_1.WebSearchService(promptBuilderService, answerRefinementService, promptTemplateService, webSearchQueryOptimizerService);
        const executionGraphBuilder = new execution_graph_builder_1.ExecutionGraphBuilder();
        const greetingExecutor = new greeting_executor_1.GreetingExecutor(conservativeResponseService);
        const timelineExecutor = new timeline_executor_1.TimelineExecutor(metadataService);
        const summaryExecutor = new summary_executor_1.SummaryExecutor(metadataService, vectorSearchService, webSearchService);
        const documentFirstExecutor = new document_executor_1.DocumentFirstExecutor(vectorSearchService, webSearchService, conservativeResponseService, metadataService);
        const webFirstExecutor = new web_executor_1.WebFirstExecutor(webSearchService, hybridRetrievalService, documentFirstExecutor);
        const refuseExecutor = new refuse_executor_1.RefuseExecutor(conservativeResponseService);
        const executorRegistry = new executor_registry_1.ExecutorRegistry(greetingExecutor, timelineExecutor, summaryExecutor, documentFirstExecutor, webFirstExecutor, refuseExecutor);
        const executionGraphService = new execution_graph_service_1.ExecutionGraphService(executionGraphBuilder, executorRegistry);
        const aggregationService = new aggregation_service_1.AggregationService();
        const conversationMemoryService = new conversation_memory_service_1.ConversationMemoryService(backendService, promptTemplateService);
        const executionOrchestratorService = new execution_orchestrator_service_1.ExecutionOrchestratorService(executorRegistry, aggregationService, answerRefinementService);
        queryProcessor = new query_processor_1.QueryProcessorService(backendService, conservativeResponseService, vectorSearchService, metadataService, webSearchService, answerRefinementService, promptTemplateService, queryRewriteService, queryDecompositionService, plannerService, executionGraphService, executionOrchestratorService, conversationMemoryService, aggregationService);
        initialized = true;
    })();
    try {
        await initializationPromise;
    }
    finally {
        initializationPromise = null;
    }
};
const handler = async (event, context) => {
    try {
        await initializeServices();
        const { chatId, question, user, connectionId, sessionId } = event;
        if (!chatId || !question || !user || !connectionId) {
            console.error('Missing required fields in event payload');
            return { statusCode: 400, body: 'Invalid request' };
        }
        const chatResponse = await backendService.getChatForAI(chatId);
        if (!chatResponse.success || !chatResponse.data) {
            await wsService.send(connectionId, {
                type: 'chat:error',
                data: {
                    success: false,
                    message: chatResponse.message || 'Chat not found',
                },
            });
            return { statusCode: 404 };
        }
        const chat = chatResponse.data;
        if (!chat.title || chat.title === 'New Chat') {
            const newTitle = question.length > 255 ? question.substring(0, 252) + '...' : question;
            try {
                await backendService.updateChatTitle(chatId, newTitle);
            }
            catch (error) {
                console.error(`Failed to update chat title: ${error.message}`);
            }
        }
        const firstDoc = chat.documentChats[0]?.Document;
        if (!firstDoc) {
            await wsService.send(connectionId, {
                type: 'chat:error',
                data: {
                    success: false,
                    message: 'No documents found in chat',
                },
            });
            return { statusCode: 400 };
        }
        const caseId = firstDoc.caseId;
        const clientId = firstDoc.clientId;
        let fileName;
        const fileNameMatch = question.match(/in\s+([^\?]+\.(?:pdf|docx|doc|txt))\s*(?:\?|$)/i);
        if (fileNameMatch) {
            const potentialFileName = fileNameMatch[1].trim();
            const fileExists = chat.documentChats.some((dc) => dc.Document.originalName.toLowerCase() ===
                potentialFileName.toLowerCase());
            if (fileExists) {
                fileName = potentialFileName;
            }
            else {
                const availableDocs = chat.documentChats
                    .map((dc) => dc.Document.originalName)
                    .join(', ');
                await wsService.send(connectionId, {
                    type: 'chat:error',
                    data: {
                        success: false,
                        message: `File "${potentialFileName}" not found. Available documents: ${availableDocs || 'none'}.`,
                    },
                });
                return { statusCode: 400 };
            }
        }
        await queryProcessor.processQuery(chatId, question, user, user.firmId, caseId, clientId, fileName, sessionId ||
            `session_${Date.now()}_${Math.random().toString(36).slice(2)}`, 
        // Emit partial responses back to the WebSocket connection
        async (partial) => {
            await wsService.send(connectionId, {
                type: 'chat:response:partial',
                data: partial,
            });
        }, 
        // Emit errors back to the WebSocket connection
        async (error) => {
            console.error('Query processing error:', error);
            await wsService.send(connectionId, {
                type: 'chat:error',
                data: error,
            });
        });
        await wsService.send(connectionId, {
            type: 'chat:response:complete',
            data: { chatId, question },
        });
        return { statusCode: 200 };
    }
    catch (error) {
        console.error('AI Lambda Error:', error);
        if (event.connectionId) {
            try {
                await wsService.send(event.connectionId, {
                    type: 'chat:error',
                    data: {
                        success: false,
                        message: error.message || 'Internal server error',
                    },
                });
            }
            catch (wsError) {
                console.error('Failed to send error to WebSocket:', wsError);
            }
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error' }),
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=lambda-handler.js.map