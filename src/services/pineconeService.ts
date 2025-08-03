
// services/PineconeService.ts
import { Pinecone } from '@pinecone-database/pinecone';

export class PineconeService {
  private pinecone: Pinecone;
  private indexName: string;

  constructor(apiKey: string, environment: string, indexName: string) {
    this.pinecone = new Pinecone({
      apiKey,
      environment
    });
    this.indexName = indexName;
  }

  async upsert(data: {
    id: string;
    values: number[];
    metadata: Record<string, any>;
  }): Promise<void> {
    const index = this.pinecone.index(this.indexName);
    await index.upsert([
      {
        id: data.id,
        values: data.values,
        metadata: data.metadata
      }
    ]);
  }

  async query(
    queryVector: number[],
    topK: number = 10,
    filter?: Record<string, any>
  ): Promise<any> {
    const index = this.pinecone.index(this.indexName);

    // Build query options conditionally
    const queryOptions: any = {
      vector: queryVector,
      topK,
      includeMetadata: true
    };

    // Only add filter if it exists
    if (filter) {
      queryOptions.filter = filter;
    }

    return await index.query(queryOptions);
  }

  async deleteByNotionId(notionPageId: string): Promise<void> {
    const index = this.pinecone.index(this.indexName);
    await index.deleteOne(notionPageId);
  }
}

