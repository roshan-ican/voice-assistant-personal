// services/NotionService.ts
import { Client } from '@notionhq/client';
import { PageObjectResponse, PartialPageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

export class NotionService {
    private notion: Client;
    private databaseId: string;

    constructor(authToken: string, databaseId: string) {
        this.notion = new Client({ auth: authToken });
        this.databaseId = databaseId;
    }



    async createPage(data: {
        title: string;
        content: string;
        properties: Record<string, any>;
    }): Promise<string> {
        // Build properties object conditionally
        const properties: any = {
            Name: {
                title: [
                    {
                        text: {
                            content: data.title
                        }
                    }
                ]
            },
            Language: {
                select: {
                    name: data.properties.language
                }
            },
            Duration: {
                number: data.properties.duration
            },
            CreatedAt: {
                date: {
                    start: new Date().toISOString()
                }
            },
            Priority: {
                select: {
                    name: data.properties.priority || 'medium'
                }
            },
            Tags: {
                multi_select: (data.properties.tags || []).map((tag: string) => ({ name: tag }))
            },
            Confidence: {
                number: data.properties.confidence || 0.5
            },
            OriginalText: {
                rich_text: [
                    {
                        text: {
                            content: data.properties.originalText || ''
                        }
                    }
                ]
            }
        };

        // Add optional properties only if they exist
        if (data.properties.project) {
            properties.Project = {
                select: {
                    name: data.properties.project
                }
            };
        }

        if (data.properties.dueDate) {
            properties.DueDate = {
                date: {
                    start: data.properties.dueDate
                }
            };
        }

        const response = await this.notion.pages.create({
            parent: {
                database_id: this.databaseId,
            },
            properties,
            children: [
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: data.content
                                }
                            }
                        ]
                    }
                }
            ]
        });

        return response.id;
    }

    async updatePage(pageId: string, content: string): Promise<void> {
        await this.notion.blocks.children.append({
            block_id: pageId,
            children: [
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: { content }
                            }
                        ]
                    }
                }
            ]
        });
    }

    async getPage(pageId: string): Promise<any> {
        try {
            // Get the page metadata
            const page = await this.notion.pages.retrieve({ page_id: pageId });

            // Get the page content (blocks)
            const blocks = await this.notion.blocks.children.list({
                block_id: pageId,
                page_size: 100
            });

            // Extract the text content from blocks
            let content = '';
            for (const block of blocks.results) {
                if ('paragraph' in block && (block as any).paragraph?.rich_text) {
                    content += (block as any).paragraph.rich_text
                        .map((text: any) => text.plain_text)
                        .join('') + '\n';
                }
            }

            // Type guard to check if it's a full page
            const isFullPage = (p: any): p is PageObjectResponse => {
                return p.object === 'page' && 'created_time' in p;
            };

            if (isFullPage(page)) {
                return {
                    id: page.id,
                    properties: page.properties,
                    content: content.trim(),
                    created_time: page.created_time,
                    last_edited_time: page.last_edited_time,
                    url: page.url
                };
            } else {
                // For partial pages, we have limited data
                return {
                    id: page.id,
                    properties: {},
                    content: content.trim(),
                    created_time: null,
                    last_edited_time: null,
                    url: null
                };
            }
        } catch (error) {
            throw new Error(`Failed to get page: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async deletePage(pageId: string): Promise<void> {
        try {
            // In Notion, we archive pages instead of deleting them
            await this.notion.pages.update({
                page_id: pageId,
                archived: true
            });
        } catch (error) {
            throw new Error(`Failed to delete page: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getRecentPages(limit: number = 10, offset: number = 0): Promise<any[]> {
        try {
            const response = await this.notion.databases.query({
                database_id: this.databaseId,
                sorts: [
                    {
                        property: 'CreatedAt',
                        direction: 'descending'
                    }
                ],
                page_size: limit,
            });

            // Type guard for full page objects
            const isFullPage = (p: any): p is PageObjectResponse => {
                return p.object === 'page' && 'properties' in p;
            };

            // Transform the results to include more readable data
            return response.results.map((page) => {
                if (isFullPage(page)) {
                    return {
                        id: page.id,
                        title: page.properties.Name?.type === 'title'
                            ? page.properties.Name.title[0]?.plain_text || 'Untitled'
                            : 'Untitled',
                        language: page.properties.Language?.type === 'select'
                            ? page.properties.Language.select?.name || 'unknown'
                            : 'unknown',
                        priority: page.properties.Priority?.type === 'select'
                            ? page.properties.Priority.select?.name || 'medium'
                            : 'medium',
                        tags: page.properties.Tags?.type === 'multi_select'
                            ? page.properties.Tags.multi_select.map((tag) => tag.name)
                            : [],
                        project: page.properties.Project?.type === 'select'
                            ? page.properties.Project.select?.name || null
                            : null,
                        dueDate: page.properties.DueDate?.type === 'date'
                            ? page.properties.DueDate.date?.start || null
                            : null,
                        confidence: page.properties.Confidence?.type === 'number'
                            ? page.properties.Confidence.number || 0
                            : 0,
                        duration: page.properties.Duration?.type === 'number'
                            ? page.properties.Duration.number || 0
                            : 0,
                        createdAt: page.properties.CreatedAt?.type === 'date'
                            ? page.properties.CreatedAt.date?.start || page.created_time
                            : page.created_time,
                        lastEditedTime: page.last_edited_time,
                        url: page.url
                    };
                } else {
                    // Partial page - return minimal data
                    return {
                        id: page.id,
                        title: 'Untitled',
                        language: 'unknown',
                        priority: 'medium',
                        tags: [],
                        project: null,
                        dueDate: null,
                        confidence: 0,
                        duration: 0,
                        createdAt: null,
                        lastEditedTime: null,
                        url: null
                    };
                }
            });
        } catch (error) {
            throw new Error(`Failed to get recent pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async searchPages(query: string): Promise<any[]> {
        try {
            const response = await this.notion.databases.query({
                database_id: this.databaseId,
                filter: {
                    or: [
                        {
                            property: 'Name',
                            title: {
                                contains: query
                            }
                        },
                        {
                            property: 'OriginalText',
                            rich_text: {
                                contains: query
                            }
                        }
                    ]
                },
                sorts: [
                    {
                        property: 'CreatedAt',
                        direction: 'descending'
                    }
                ]
            });

            // Type guard for full page objects
            const isFullPage = (p: any): p is PageObjectResponse => {
                return p.object === 'page' && 'properties' in p;
            };

            return response.results.map((page) => {
                if (isFullPage(page)) {
                    return {
                        id: page.id,
                        title: page.properties.Name?.type === 'title'
                            ? page.properties.Name.title[0]?.plain_text || 'Untitled'
                            : 'Untitled',
                        language: page.properties.Language?.type === 'select'
                            ? page.properties.Language.select?.name || 'unknown'
                            : 'unknown',
                        priority: page.properties.Priority?.type === 'select'
                            ? page.properties.Priority.select?.name || 'medium'
                            : 'medium',
                        tags: page.properties.Tags?.type === 'multi_select'
                            ? page.properties.Tags.multi_select.map((tag) => tag.name)
                            : [],
                        createdAt: page.properties.CreatedAt?.type === 'date'
                            ? page.properties.CreatedAt.date?.start || page.created_time
                            : page.created_time,
                        url: page.url
                    };
                } else {
                    return {
                        id: page.id,
                        title: 'Untitled',
                        language: 'unknown',
                        priority: 'medium',
                        tags: [],
                        createdAt: null,
                        url: null
                    };
                }
            });
        } catch (error) {
            throw new Error(`Failed to search pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Helper method to verify database schema
    async verifyDatabaseSchema(): Promise<void> {
        try {
            const database = await this.notion.databases.retrieve({
                database_id: this.databaseId
            });

            const requiredProperties = [
                'Name', 'Language', 'Duration', 'CreatedAt',
                'Priority', 'Tags', 'Project', 'DueDate',
                'Confidence', 'OriginalText'
            ];

            const existingProperties = Object.keys(database.properties);
            const missingProperties = requiredProperties.filter(
                prop => !existingProperties.includes(prop)
            );

            if (missingProperties.length > 0) {
                console.warn('Missing Notion database properties:', missingProperties);
                console.warn('Please add these properties to your Notion database');
            }
        } catch (error) {
            throw new Error(`Failed to verify database schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}