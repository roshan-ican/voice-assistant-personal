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
            const { language = 'en', mimeType = 'audio/webm' } = options;

            // Convert buffer to base64
            const audioBase64 = audioBuffer.toString('base64');

            logger.info(`🎤 Transcribing audio: ${audioBuffer.length} bytes, ${mimeType}, ${language}`);

            // Create prompt for transcription
            const prompt = this.buildTranscriptionPrompt(language);

            const result = await this.speechModel.generateContent([
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBase64
                    }
                },
                { text: prompt }
            ]);

            const transcription = result.response.text().trim();
            const processingTime = Date.now() - startTime;

            // Basic confidence scoring (Gemini doesn't provide this directly)
            const confidence = this.estimateConfidence(transcription, audioBuffer.length, processingTime);

            logger.info(`✅ Transcription completed: "${transcription}" (${processingTime}ms)`);

            return {
                text: transcription,
                confidence,
                language,
                processingTime
            };

        } catch (error) {
            logger.error('❌ Gemini transcription failed:', error);
            throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

            // Validate and sanitize the response
            return {
                cleaned_text: parsed.cleaned_text || 'Unknown task',
                priority: this.validatePriority(parsed.priority),
                due_date: parsed.due_date || null,
                tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : [],
                confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
                project: parsed.project || undefined,
                estimated_duration: parsed.estimated_duration || undefined,
                intent: {
                    action: parsed.intent?.action || 'create_todo',
                    confidence: Math.max(0, Math.min(1, parsed.intent?.confidence || 0.5))
                }
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