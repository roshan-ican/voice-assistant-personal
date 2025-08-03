import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { GeminiService, EnhancedTodoResult, GeminiTranscriptionResult } from '../services/geminiService';
import { NotionService } from '@/services/notionService';
import { PineconeService } from '@/services/pineconeService';


// Extend FastifyInstance with your services
declare module 'fastify' {
  interface FastifyInstance {
    geminiService: GeminiService;
    notionService: NotionService;
    pineconeService: PineconeService;
  }
}

interface AudioSession {
  id: string;
  audioChunks: Buffer[];
  transcriptions: string[];
  language?: string;
  startTime: Date;
}

// Store active sessions
const activeSessions = new Map<string, AudioSession>();

export function setupVoiceWebSocket(app: FastifyInstance) {
  app.get('/ws/voice', { websocket: true }, (connection, req) => {
    const ws = connection.socket;
    const sessionId = generateSessionId();

    // Initialize session
    activeSessions.set(sessionId, {
      id: sessionId,
      audioChunks: [],
      transcriptions: [],
      startTime: new Date()
    });

    console.log(`New voice session started: ${sessionId}`);

    ws.on('message', async (message: Buffer) => {
      try {
        const session = activeSessions.get(sessionId);
        if (!session) {
          throw new Error('Session not found');
        }

        // Handle different message types
        const messageType = detectMessageType(message);

        switch (messageType) {
          case 'audio':
            // Store audio chunk
            session.audioChunks.push(message);

            // Send acknowledgment
            ws.send(JSON.stringify({
              type: 'audio_received',
              chunkSize: message.length,
              totalChunks: session.audioChunks.length
            }));
            break;

          case 'command':
            const command = JSON.parse(message.toString());
            await handleCommand(command, ws, sessionId, app);
            break;
        }
      } catch (error) {
        console.error('Error processing voice message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message',
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', async () => {
      try {
        const session = activeSessions.get(sessionId);
        if (!session || session.audioChunks.length === 0) {
          console.log(`Voice session ended with no audio: ${sessionId}`);
          activeSessions.delete(sessionId);
          return;
        }

        // Process the complete audio
        const result = await processCompleteAudio(session, app);

        console.log(`Voice session completed: ${sessionId}`, result);
        activeSessions.delete(sessionId);
      } catch (error) {
        console.error('Error finalizing session:', error);
        activeSessions.delete(sessionId);
      }
    });

    // Send initial connection success
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'Voice connection established'
    }));
  });
}

async function processCompleteAudio(
  session: AudioSession,
  app: FastifyInstance
): Promise<{ notionPageId: string; pineconeId: string }> {
  // 1. Concatenate all audio chunks
  const completeAudio = Buffer.concat(session.audioChunks);
  console.log(`Processing ${completeAudio.length} bytes of audio`);

  // 2. Transcribe using Gemini
  const transcriptionResult: GeminiTranscriptionResult = await app.geminiService.transcribeAudio(
    completeAudio,
    {
      language: session.language as any || 'en',
      mimeType: 'audio/webm'
    }
  );

  // 3. Enhance the transcription
  const enhancedResult: EnhancedTodoResult = await app.geminiService.enhanceTranscription(
    transcriptionResult.text,
    transcriptionResult.language as any
  );

  // 4. Generate embeddings
  const embeddingResult = await app.geminiService.generateEmbedding(enhancedResult.cleaned_text);

  // 5. Store in Notion - using lowercase notionService
  const notionPageId = await app.notionService.createPage({
    title: `Voice Note - ${new Date().toLocaleDateString()}`,
    content: enhancedResult.cleaned_text,
    properties: {
      language: transcriptionResult.language,
      duration: Math.floor((Date.now() - session.startTime.getTime()) / 1000),
      originalText: transcriptionResult.text,
      priority: enhancedResult.priority,
      tags: enhancedResult.tags,
      confidence: enhancedResult.confidence,
      dueDate: enhancedResult.due_date,
      project: enhancedResult.project
    }
  });

  // 6. Store in Pinecone - using lowercase pineconeService
  await app.pineconeService.upsert({
    id: notionPageId,
    values: embeddingResult.embedding,
    metadata: {
      text: enhancedResult.cleaned_text,
      originalText: transcriptionResult.text,
      language: transcriptionResult.language,
      timestamp: new Date().toISOString(),
      notionPageId,
      priority: enhancedResult.priority,
      tags: enhancedResult.tags,
      project: enhancedResult.project,
      intent: enhancedResult.intent.action
    }
  });

  return { notionPageId, pineconeId: notionPageId };
}

async function handleCommand(
  command: any,
  ws: WebSocket,
  sessionId: string,
  app: FastifyInstance
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Session not found'
    }));
    return;
  }

  switch (command.type) {
    case 'start_recording':
      session.startTime = new Date();
      session.audioChunks = [];
      ws.send(JSON.stringify({
        type: 'recording_started',
        sessionId,
        timestamp: session.startTime.toISOString()
      }));
      break;

    case 'stop_recording':
      if (session.audioChunks.length > 0) {
        ws.send(JSON.stringify({
          type: 'processing',
          message: 'Processing your recording...'
        }));

        try {
          const result = await processCompleteAudio(session, app);
          ws.send(JSON.stringify({
            type: 'recording_processed',
            notionPageId: result.notionPageId,
            message: 'Voice note saved successfully!'
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process recording',
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'No audio data to process'
        }));
      }
      break;

    case 'set_language':
      if (command.language) {
        session.language = command.language;
        ws.send(JSON.stringify({
          type: 'language_set',
          language: command.language
        }));
      }
      break;

    case 'get_status':
      ws.send(JSON.stringify({
        type: 'status',
        sessionId,
        isActive: true,
        audioChunks: session.audioChunks.length,
        duration: Math.floor((Date.now() - session.startTime.getTime()) / 1000)
      }));
      break;
  }
}

function generateSessionId(): string {
  return `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function detectMessageType(message: Buffer): 'audio' | 'command' {
  // If it starts with '{' it's likely JSON command
  try {
    const str = message.toString('utf8');
    JSON.parse(str);
    return 'command';
  } catch {
    return 'audio';
  }
}