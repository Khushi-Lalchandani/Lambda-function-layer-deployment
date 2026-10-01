import { Context } from 'aws-lambda';
import { QueryProcessorService } from './services/query.processor';
import { BackendService } from './services/backend.service';
import { WebSocketService } from './services/websocket.service';
import { ConservativeResponseService } from './services/conservative-response.service';
import { VectorSearchService } from './services/vector-service';
import { HybridRetrievalService } from './services/hybrid-retrieval.service';
import { ChunkRerankService } from './services/chunk-rerank.service';
import { MetadataService } from './services/metadata.service';
import { WebSearchService } from './services/web-search.service';
import { WebSearchQueryOptimizerService } from './services/web-search-query-optimizer.service';
import { AnswerRefinementService } from './services/answer-refinement.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { QueryRewriteService } from './services/query-rewrite.service';
import { QueryDecompositionService } from './services/query-decomposition.service';
import { PlannerService } from './services/planner.service';
import { ExecutionGraphBuilder } from './services/execution-graph-builder';
import { ExecutionGraphService } from './services/execution-graph.service';
import { ExecutionOrchestratorService } from './services/execution-orchestrator.service';
import { AggregationService } from './services/aggregation.service';
import { ConversationMemoryService } from './services/conversation-memory.service';
import { ExecutorRegistry } from './services/executor-registry';
import { GreetingExecutor } from './services/executors/greeting.executor';
import { TimelineExecutor } from './services/executors/timeline.executor';
import { SummaryExecutor } from './services/executors/summary.executor';
import { DocumentFirstExecutor } from './services/executors/document.executor';
import { WebFirstExecutor } from './services/executors/web.executor';
import { RefuseExecutor } from './services/executors/refuse.executor';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { resetLlmGateway } from './services/llm-gateway.service';

let initialized = false;
let initializationPromise: Promise<void> | null = null;
let backendService: BackendService;
let wsService: WebSocketService;
let queryProcessor: QueryProcessorService;

const parseSecret = (secretString: string): Record<string, string> => {
  try {
    return JSON.parse(secretString);
  } catch (error: any) {
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
    const secretsClient = new SecretsManagerClient({ region });

    const secretResponse = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );

    if (!secretResponse.SecretString) {
      throw new Error(`Secret ${secretName} has no SecretString value`);
    }

    const secrets = parseSecret(secretResponse.SecretString);
    const openAIKey = secrets.OPENAI_KEY;
    const serviceAccountJson = secrets.SIMPLCASE_SERVICE_ACC_JSON;

    if (!openAIKey || !serviceAccountJson) {
      throw new Error(
        `Secret ${secretName} must include OPENAI_KEY and SIMPLCASE_SERVICE_ACC_JSON`,
      );
    }

    process.env.OPENAI_KEY = openAIKey;
    process.env.SIMPLCASE_SERVICE_ACC_JSON = serviceAccountJson;
    resetLlmGateway();

    backendService = new BackendService();
    wsService = new WebSocketService();
    const promptTemplateService = new PromptTemplateService();
    const queryRewriteService = new QueryRewriteService(promptTemplateService);
    const queryDecompositionService = new QueryDecompositionService(
      promptTemplateService,
    );
    const plannerService = new PlannerService(promptTemplateService);
    const promptBuilderService = new PromptBuilderService(promptTemplateService);
    const answerRefinementService = new AnswerRefinementService(
      promptTemplateService,
    );
    const conservativeResponseService = new ConservativeResponseService();
    const chunkRerankService = new ChunkRerankService(promptTemplateService);
    const hybridRetrievalService = new HybridRetrievalService(
      backendService,
      chunkRerankService,
    );
    const vectorSearchService = new VectorSearchService(
      backendService,
      hybridRetrievalService,
      promptBuilderService,
      answerRefinementService,
    );
    const metadataService = new MetadataService(
      backendService,
      answerRefinementService,
      promptTemplateService,
    );
    const webSearchQueryOptimizerService = new WebSearchQueryOptimizerService(
      promptTemplateService,
    );
    const webSearchService = new WebSearchService(
      promptBuilderService,
      answerRefinementService,
      promptTemplateService,
      webSearchQueryOptimizerService,
    );
    const executionGraphBuilder = new ExecutionGraphBuilder();
    const greetingExecutor = new GreetingExecutor(conservativeResponseService);
    const timelineExecutor = new TimelineExecutor(metadataService);
    const summaryExecutor = new SummaryExecutor(
      metadataService,
      vectorSearchService,
      webSearchService,
    );
    const documentFirstExecutor = new DocumentFirstExecutor(
      vectorSearchService,
      webSearchService,
      conservativeResponseService,
      metadataService,
    );
    const webFirstExecutor = new WebFirstExecutor(
      webSearchService,
      hybridRetrievalService,
      documentFirstExecutor,
    );
    const refuseExecutor = new RefuseExecutor(conservativeResponseService);
    const executorRegistry = new ExecutorRegistry(
      greetingExecutor,
      timelineExecutor,
      summaryExecutor,
      documentFirstExecutor,
      webFirstExecutor,
      refuseExecutor,
    );
    const executionGraphService = new ExecutionGraphService(
      executionGraphBuilder,
      executorRegistry,
    );
    const aggregationService = new AggregationService();
    const conversationMemoryService = new ConversationMemoryService(
      backendService,
      promptTemplateService,
    );
    const executionOrchestratorService = new ExecutionOrchestratorService(
      executorRegistry,
      aggregationService,
      answerRefinementService,
    );
    queryProcessor = new QueryProcessorService(
      backendService,
      conservativeResponseService,
      vectorSearchService,
      metadataService,
      webSearchService,
      answerRefinementService,
      promptTemplateService,
      queryRewriteService,
      queryDecompositionService,
      plannerService,
      executionGraphService,
      executionOrchestratorService,
      conversationMemoryService,
      aggregationService,
    );

    initialized = true;
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
};

export const handler = async (event: any, context: Context) => {
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
      const newTitle =
        question.length > 255 ? question.substring(0, 252) + '...' : question;

      try {
        await backendService.updateChatTitle(chatId, newTitle);
      } catch (error: any) {
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

    let fileName: string | undefined;
    const fileNameMatch = question.match(
      /in\s+([^\?]+\.(?:pdf|docx|doc|txt))\s*(?:\?|$)/i,
    );
    if (fileNameMatch) {
      const potentialFileName = fileNameMatch[1].trim();

      const fileExists = chat.documentChats.some(
        (dc: any) =>
          dc.Document.originalName.toLowerCase() ===
          potentialFileName.toLowerCase(),
      );

      if (fileExists) {
        fileName = potentialFileName;
      } else {
        const availableDocs = chat.documentChats
          .map((dc: any) => dc.Document.originalName)
          .join(', ');

        await wsService.send(connectionId, {
          type: 'chat:error',
          data: {
            success: false,
            message: `File "${potentialFileName}" not found. Available documents: ${
              availableDocs || 'none'
            }.`,
          },
        });
        return { statusCode: 400 };
      }
    }

    await queryProcessor.processQuery(
      chatId,
      question,
      user,
      user.firmId,
      caseId,
      clientId,
      fileName,
      sessionId ||
        `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      // Emit partial responses back to the WebSocket connection
      async (partial: any) => {
        await wsService.send(connectionId, {
          type: 'chat:response:partial',
          data: partial,
        });
      },
      // Emit errors back to the WebSocket connection
      async (error: any) => {
        console.error('Query processing error:', error);
        await wsService.send(connectionId, {
          type: 'chat:error',
          data: error,
        });
      },
    );

    await wsService.send(connectionId, {
      type: 'chat:response:complete',
      data: { chatId, question },
    });

    return { statusCode: 200 };
  } catch (error: any) {
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
      } catch (wsError) {
        console.error('Failed to send error to WebSocket:', wsError);
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
