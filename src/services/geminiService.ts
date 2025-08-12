// src/services/geminiService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { LanguageCode } from '../types/index.js';

export interface GeminiTranscriptionResult {
    text: string;
    confidence: number;
    language: LanguageCode;
    processingTime: number;
}

export interface GeminiEmbeddingResult {
    embedding: number[];
    model: string;
    dimensions: number;
}

export interface EnhancedTodoResult {
    cleaned_text: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    due_date: string | null;
    tags: string[];
    confidence: number;
    project?: string;
    estimated_duration?: number;
    intent: {
        action: string;
        confidence: number;
    };
}

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private speechModel: any;
    private textModel: any;

    constructor() {
        if (!config.apis.gemini) {
            throw new Error('Gemini API key is required');
        }

        this.genAI = new GoogleGenerativeAI(config.apis.gemini);

        // Initialize models
        this.speechModel = this.genAI.getGenerativeModel({
            model: "gemini-1.5-flash"
        });

        this.textModel = this.genAI.getGenerativeModel({
            model: "gemini-1.5-flash"
        });

        logger.info('🤖 Gemini service initialized');
    }

    /**
     * Transcribe audio buffer to text using Gemini
     */
    async transcribeAudio(
        audioBuffer: Buffer,
        options: {
            language?: LanguageCode;
            mimeType?: string;
        } = {}
    ): Promise<GeminiTranscriptionResult> {
        const startTime = Date.now();
        try {
            console.log(audioBuffer, "__audio_beffer")
            const { language = 'en', mimeType = 'audio/webm' } = options;

            // VALIDATION: Check audio buffer size and format
            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Empty audio buffer provided');
            }

            // Check if buffer is too large (Gemini has limits)
            const maxSize = 20 * 1024 * 1024; // 20MB limit for Gemini
            if (audioBuffer.length > maxSize) {
                throw new Error(`Audio file too large: ${audioBuffer.length} bytes (max: ${maxSize})`);
            }

            // Validate audio format
            const validMimeTypes = [
                'audio/wav',
                'audio/mp3',
                'audio/mp4',
                'audio/mpeg',
                'audio/webm',
                'audio/flac'
            ];

            if (!validMimeTypes.includes(mimeType)) {
                logger.warn(`Unsupported mime type: ${mimeType}, defaulting to audio/wav`);
                options.mimeType = 'audio/wav';
            }

            // Check if the buffer actually contains audio data
            const audioBase64 = audioBuffer.toString('base64');

            // Basic validation - check if it's actually base64
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
                throw new Error('Invalid audio data format');
            }

            logger.info(`🎤 Transcribing audio: ${audioBuffer.length} bytes, ${mimeType}, ${language}`);

            // Try with simpler approach first
            const prompt = `Please transcribe this audio to text. Language: ${language}`;

            const result = await this.speechModel.generateContent([
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBase64
                    }
                },
                { text: prompt }
            ]);

            console.log(result, "__speech_model_")

            const transcription = result.response.text().trim();
            const processingTime = Date.now() - startTime;
            const confidence = this.estimateConfidence(transcription, audioBuffer.length, processingTime);

            logger.info(`✅ Transcription completed: "${transcription}" (${processingTime}ms)`);

            return {
                text: transcription,
                confidence,
                language,
                processingTime
            };

        } catch (error: any) {
            logger.error('❌ Gemini transcription failed:', error);

            // Return fallback response instead of throwing
            return {
                text: '',
                confidence: 0,
                language: options.language || 'en',
                processingTime: Date.now() - startTime,
                // error: error ? 'Unknown transcription error' : "";
            };
        }
    }

    // Add this method to your GeminiService class

    /**
     * Parse voice command intent for todo operations
     */
    async parseVoiceCommand(text: string, context?: any): Promise<{
        dueDate: string | undefined;
        area: string | undefined;
        project: string | undefined;
        priority: string;
        action: 'create' | 'complete' | 'update' | 'delete' | 'list' | 'unclear';
        todoText?: string;
        targetTodo?: string;
        newText?: string;
        pageHint?: string;
        confidence: number;
    }> {
        try {
            const prompt = `
            Analyze this voice command for a todo app and extract the user's intent.

            ## Command
            "${text}"

            ## Context
            - Current page ID: ${context?.currentPageId || 'none'}
            - Today's Date: ${new Date().toLocaleDateString()}

            ## Rules for Intent Recognition
            1.  **Completion Intent:** Commands using past-tense verbs (e.g., "bought", "finished", "completed", "learnt", "sent") strongly imply a 'complete' action. The 'targetTodo' should be the object of the action (e.g., for "bought milk", the target is "milk").
            2.  **Creation Intent:** Commands usually start with verbs like "add", "create", "remind me to", or are simple noun phrases (e.g., "buy milk").
            3.  **Update Intent:** Look for keywords like "change", "update", "rename".
            4.  **Targeting:** Identify the task being referred to. This can be by its name or position ("the first one", "the last task").

            ## Examples
            - "add buy milk for the party tomorrow" → action: create, todoText: "buy milk for the party"
            - "remind me to call the doctor" → action: create, todoText: "call the doctor"
            - "finished the quarterly report" → action: complete, targetTodo: "quarterly report"
            - "bought the groceries" → action: complete, targetTodo: "groceries"
            - "I learnt DSA" → action: complete, targetTodo: "DSA"
            - "check off the first one" → action: complete, targetTodo: "first"
            - "change milk to almond milk" → action: update, targetTodo: "milk", newText: "almond milk"
            - "delete the 'review design' task" → action: delete, targetTodo: "review design"
            - "show my tasks" → action: list
            - "what's on my list for today" → action: list

            ## Output
            Return a single, minified JSON object with your analysis.

            JSON:
        `;

            const result = await this.textModel.generateContent(prompt);
            const response = result.response.text();

            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in LLM response');
            }

            // Add null defaults to prevent downstream errors
            const parsedJson = JSON.parse(jsonMatch[0]);
            return {
                dueDate: undefined,
                area: undefined,
                project: undefined,
                priority: 'Medium',
                todoText: undefined,
                targetTodo: undefined,
                newText: undefined,
                pageHint: undefined,
                ...parsedJson
            };

        } catch (error) {
            // Your fallback logic can remain as a last resort
            console.error('Failed to parse voice command with LLM, using fallback:', error);

            const lowerText = text.toLowerCase();

            if (lowerText.includes('add') || lowerText.includes('create')) {
                const todoText = text.replace(/^(add|create|make)\s+/i, '').trim();
                return { action: 'create', todoText, confidence: 0.8 } as any;
            }

            if (lowerText.includes('complete') || lowerText.includes('done') || lowerText.includes('check')) {
                const targetTodo = text.replace(/^(complete|done|check|mark)\s+/i, '').trim();
                return { action: 'complete', targetTodo, confidence: 0.7 } as any;
            }

            if (lowerText.includes('update') || lowerText.includes('change')) {
                const match = text.match(/(?:update|change)\s+(.+?)\s+to\s+(.+)/i);
                if (match) {
                    return {
                        action: 'update',
                        targetTodo: match[1]?.trim(),
                        newText: match[2]?.trim(),
                        confidence: 0.7
                    } as any;
                }
            }

            if (lowerText.includes('delete') || lowerText.includes('remove')) {
                const targetTodo = text.replace(/^(delete|remove)\s+/i, '').trim();
                return { action: 'delete', targetTodo, confidence: 0.7 } as any;
            }

            if (lowerText.includes('show') || lowerText.includes('list')) {
                return { action: 'list', confidence: 0.9 } as any;
            }

            return { action: 'unclear', confidence: 0.3 } as any;
        }
    }

    /**
     * Enhance transcription and extract todo information
     */
    async enhanceTranscription(
        rawText: string,
        language: LanguageCode = 'en'
    ): Promise<EnhancedTodoResult> {
        try {
            logger.info(`🧠 Enhancing transcription: "${rawText}"`);

            const prompt = this.buildEnhancementPrompt(rawText, language);

            const result = await this.textModel.generateContent(prompt);
            const responseText = result.response.text();

            // Parse JSON response
            const enhanced = this.parseEnhancedResponse(responseText);

            logger.info(`✨ Enhancement completed: ${enhanced.intent.action} - "${enhanced.cleaned_text}"`);

            return enhanced;

        } catch (error) {
            logger.error('❌ Gemini enhancement failed:', error);

            // Fallback to basic parsing if AI fails
            return this.fallbackEnhancement(rawText);
        }
    }

    /**
     * Generate embeddings for semantic search
     */
    async generateEmbedding(text: string): Promise<GeminiEmbeddingResult> {
        try {
            logger.info(`🧬 Generating embedding for: "${text.substring(0, 50)}..."`);

            // Use text-embedding-004 model
            const embeddingModel = this.genAI.getGenerativeModel({
                model: "text-embedding-004"
            });

            const result = await embeddingModel.embedContent(text);

            return {
                embedding: result.embedding.values,
                model: 'text-embedding-004',
                dimensions: result.embedding.values.length
            };

        } catch (error) {
            logger.error('❌ Gemini embedding failed:', error);
            throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Detect language from audio transcription
     */
    async detectLanguage(text: string): Promise<LanguageCode> {
        try {
            const prompt = `
        Detect the language of this text and return ONLY the 2-letter language code:
        
        Text: "${text}"
        
        Supported languages: en, es, fr, de, it, pt, ru, ja, ko, zh, hi, ar
        
        Return only the language code (e.g., "en" for English, "es" for Spanish):
      `;

            const result = await this.textModel.generateContent(prompt);
            const detectedLang = result.response.text().trim().toLowerCase();

            // Validate and return supported language
            const supportedLangs: LanguageCode[] = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'hi', 'ar'];

            if (supportedLangs.includes(detectedLang as LanguageCode)) {
                return detectedLang as LanguageCode;
            }

            // Default to English if detection fails
            return 'en';

        } catch (error) {
            logger.error('❌ Language detection failed:', error);
            return 'en'; // Default fallback
        }
    }

    // Private helper methods
    private buildTranscriptionPrompt(language: LanguageCode): string {
        const languageNames: Record<LanguageCode, string> = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
            'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese',
            'ko': 'Korean', 'zh': 'Chinese', 'hi': 'Hindi', 'ar': 'Arabic'
        };

        return `
      Please transcribe this audio to text in ${languageNames[language]}.
      
      Instructions:
      - Return ONLY the transcribed text, no explanations
      - Fix any obvious speech recognition errors
      - Use proper punctuation and capitalization
      - If the audio is unclear, transcribe what you can hear
      - If no speech is detected, return "No speech detected"
    `;
    }

    private buildEnhancementPrompt(rawText: string, language: LanguageCode): string {
        return `
      Analyze this voice transcription and extract todo information. Return a JSON object with the following structure:

      {
        "cleaned_text": "Clean, actionable todo text",
        "priority": "low|medium|high|urgent",
        "due_date": "YYYY-MM-DD or null",
        "tags": ["tag1", "tag2"],
        "confidence": 0.0-1.0,
        "project": "project name or null",
        "estimated_duration": minutes or null,
        "intent": {
          "action": "create_todo|set_reminder|schedule_task|unknown",
          "confidence": 0.0-1.0
        }
      }

      Voice transcription: "${rawText}"

      Rules:
      - Extract clear, actionable todo text
      - Infer priority from words like "urgent", "important", "asap", "high priority"
      - Extract dates from phrases like "tomorrow", "next week", "Monday", "by Friday"
      - Generate relevant tags based on content (max 3 tags)
      - Estimate duration from context clues
      - Identify project names if mentioned
      - Set confidence based on clarity and completeness

      Return ONLY the JSON object, no additional text.
    `;
    }

    private parseEnhancedResponse(responseText: string): EnhancedTodoResult {
        try {
            // Clean the response to extract JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Ensure action is one of the valid types
            const validActions = ['create', 'complete', 'update', 'delete', 'list', 'unclear'];
            const action = validActions.includes(parsed.action) ? parsed.action : 'unclear';

            return {
                ...parsed,
                action: action as 'create' | 'complete' | 'update' | 'delete' | 'list' | 'unclear'
            };

        } catch (error) {
            logger.error('Failed to parse Gemini response:', error);
            throw new Error('Failed to parse AI response');
        }
    }

    private validatePriority(priority: string): 'low' | 'medium' | 'high' | 'urgent' {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        return validPriorities.includes(priority) ? priority as any : 'medium';
    }

    private fallbackEnhancement(rawText: string): EnhancedTodoResult {
        logger.warn('Using fallback enhancement for:', rawText);

        return {
            cleaned_text: rawText.replace(/^(add|create|make|do|remember to)\s+/i, '').trim() || 'Unknown task',
            priority: 'medium',
            due_date: null,
            tags: [],
            confidence: 0.3,
            intent: {
                action: 'create_todo',
                confidence: 0.5
            }
        };
    }

    private estimateConfidence(
        transcription: string,
        audioLength: number,
        processingTime: number
    ): number {
        let confidence = 0.8; // Base confidence

        // Adjust based on transcription length vs audio length
        const wordsPerSecond = transcription.split(' ').length / (audioLength / 1000);
        if (wordsPerSecond < 1 || wordsPerSecond > 10) {
            confidence -= 0.2;
        }

        // Adjust based on processing time (very fast might mean poor quality)
        if (processingTime < 500) {
            confidence -= 0.1;
        }

        // Check for common transcription errors
        if (transcription.includes('...') || transcription.length < 3) {
            confidence -= 0.3;
        }

        return Math.max(0.1, Math.min(1.0, confidence));
    }

    /**
     * Health check for Gemini service
     */
    async healthCheck(): Promise<{ status: string; model: string; error?: string }> {
        try {
            // Test with a simple text generation
            const result = await this.textModel.generateContent("Say 'healthy'");
            const response = result.response.text();

            return {
                status: response.toLowerCase().includes('healthy') ? 'healthy' : 'degraded',
                model: 'gemini-1.5-flash'
            };
        } catch (error) {
            return {
                status: 'error',
                model: 'gemini-1.5-flash',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}



export class EnhancedGeminiService {
    private genAI: GoogleGenerativeAI;
    private textModel: any;
    private embeddingModel: any;

    constructor(apiKey: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.textModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash-flash' });
        this.embeddingModel = this.genAI.getGenerativeModel({ model: 'embedding-001' });
    }

    async enhanceText(text: string): Promise<string> {
        const prompt = `
      Enhance the following transcribed text by:
      1. Fixing grammar and punctuation
      2. Adding proper formatting
      3. Maintaining the original meaning
      4. Making it more readable
      
      Original text: ${text}
      
      Enhanced text:
    `;

        const result = await this.textModel.generateContent(prompt);
        return result.response.text();
    }

    async generateEmbeddings(text: string): Promise<number[]> {
        const result = await this.embeddingModel.embedContent(text);
        return result.embedding.values;
    }

    async detectLanguage(text: string): Promise<string> {
        const prompt = `Detect the language of this text and return only the ISO 639-1 language code: "${text}"`;
        const result = await this.textModel.generateContent(prompt);
        return result.response.text().trim();
    }

    async summarize(text: string): Promise<string> {
        const prompt = `Provide a concise summary of the following text in 2-3 sentences: "${text}"`;
        const result = await this.textModel.generateContent(prompt);
        return result.response.text();
    }
}