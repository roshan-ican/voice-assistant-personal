// services/ElevenLabsService.ts
import axios from 'axios';

export class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async detectLanguage(audioBuffer: Buffer): Promise<string> {
    // ElevenLabs language detection
    const response = await axios.post(
      `${this.baseUrl}/audio/language-detection`,
      audioBuffer,
      {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'audio/wav'
        }
      }
    );
    return response.data.detected_language;
  }

  async textToSpeech(text: string, voiceId: string, language?: string): Promise<Buffer> {
    const response = await axios.post(
      `${this.baseUrl}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      },
      {
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    return Buffer.from(response.data);
  }
}


