
export const updateTodoSchema = {
  params: {
    type: 'object',
    properties: {
      blockId: { type: 'string' },
    },
    required: ['blockId']
  },
  body: {
    type: 'object',
    properties: {
      checked: { type: 'boolean' },
      text: { type: 'string' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            blockId: { type: 'string' },
            checked: { type: ['boolean', 'null'] },
            text: { type: ['string', 'null'] }
          }
        }
      }
    }
  }
};

export const getPageTodosSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string' }
    },
    required: ['id']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pageId: { type: 'string' },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              checked: { type: 'boolean' },
              createdTime: { type: 'string' },
              lastEditedTime: { type: 'string' }
            }
          }
        },
        totalTodos: { type: 'number' },
        completedTodos: { type: 'number' }
      }
    }
  }
};

export const getBlockInfoSchema = {
  params: {
    type: 'object',
    properties: {
      blockId: { type: 'string' }
    },
    required: ['blockId']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        blockInfo: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            hasChildren: { type: 'boolean' },
            createdTime: { type: 'string' },
            lastEditedTime: { type: 'string' },
            content: { type: ['object', 'null'] }
          }
        }
      }
    }
  }
};

export const getAllTodosRecursiveSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string' }
    },
    required: ['id']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pageId: { type: 'string' },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              checked: { type: 'boolean' },
              createdTime: { type: 'string' },
              lastEditedTime: { type: 'string' },
              parentPage: { type: 'string' },
              parentPageId: { type: 'string' }
            }
          }
        },
        totalTodos: { type: 'number' },
        completedTodos: { type: 'number' }
      }
    }
  }
};