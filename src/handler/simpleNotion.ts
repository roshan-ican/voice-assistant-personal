// simpleVoiceHandler.ts
import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

interface VoiceSession {
  id: string;
  audioChunks: Buffer[];
  language: string;
}

const sessions = new Map<string, VoiceSession>();

export function setupSimpleVoiceWebSocket(app: FastifyInstance) {
  app.get('/ws/notion/voice', { websocket: true }, (connection, req) => {
    const ws = connection.socket;
    const sessionId = `session_${Date.now()}`;
    
    // Create new session
    sessions.set(sessionId, {
      id: sessionId,
      audioChunks: [],
      language: 'en'
    });

    console.log(`New voice session: ${sessionId}`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'Ready to record'
    }));

    ws.on('message', async (message: Buffer) => {
      try {
        const session = sessions.get(sessionId);
        if (!session) return;

        // Check if it's a command or audio data
        try {
          const command = JSON.parse(message.toString());
          await handleCommand(command, ws, session, app);
        } catch {
          // It's audio data
          session.audioChunks.push(message);
          ws.send(JSON.stringify({
            type: 'audio_received',
            chunks: session.audioChunks.length
          }));
        }
      } catch (error) {
        console.error('Error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      console.log(`Session closed: ${sessionId}`);
      sessions.delete(sessionId);
    });
  });
}

async function handleCommand(
  command: any,
  ws: WebSocket,
  session: VoiceSession,
  app: FastifyInstance
) {
  switch (command.type) {
    case 'set_language':
      session.language = command.language || 'en';
      ws.send(JSON.stringify({
        type: 'language_set',
        language: session.language
      }));
      break;

    case 'process_audio':
      if (session.audioChunks.length === 0) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'No audio to process'
        }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'processing',
        message: 'Processing your voice note...'
      }));

      try {
        // 1. Combine audio chunks
        const audioBuffer = Buffer.concat(session.audioChunks);
        console.log(`Processing ${audioBuffer.length} bytes of audio`);

        // 2. Transcribe with Gemini
        const transcription = await app.geminiService.transcribeAudio(audioBuffer, {
          language: session.language as any,
          mimeType: 'audio/webm'
        });

        // 3. Enhance the transcription
        const enhanced = await app.geminiService.enhanceTranscription(
          transcription.text,
          transcription.language as any
        );

        // 4. Save to Notion
        const notionPageId = await app.notionService.createPage({
          title: `Voice Note - ${new Date().toLocaleDateString()}`,
          content: enhanced.cleaned_text,
          properties: {
            language: transcription.language,
            originalText: transcription.text,
            priority: enhanced.priority,
            confidence: enhanced.confidence,
            tags: enhanced.tags,
            duration: Math.floor(audioBuffer.length / 1000) // rough estimate
          }
        });

        console.log('Created Notion page with ID:', notionPageId);
        console.log('ID length:', notionPageId.length);
        console.log('ID format:', notionPageId.includes('-') ? 'with-dashes' : 'no-dashes');

        // 5. Clear audio chunks for next recording
        session.audioChunks = [];

        ws.send(JSON.stringify({
          type: 'success',
          message: 'Voice note saved!',
          data: {
            notionPageId,
            transcription: transcription.text,
            enhanced: enhanced.cleaned_text,
            language: transcription.language
          }
        }));

      } catch (error) {
        console.error('Processing error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process audio',
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
      break;
  }
}