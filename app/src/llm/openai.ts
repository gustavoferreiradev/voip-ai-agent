// src/llm/openai.ts
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { env } from '../env.js';
import { log } from '../logger.js';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
Você é o assistente de portaria de um condomínio residencial.
Atenda o porteiro ou visitante com cordialidade e objetividade.

Responsabilidades:
- Identificar o apartamento de destino quando há entrega ou visita
- Acionar o morador do apartamento correspondente via função
- Informar ao porteiro o status da chamada

Regras:
- Respostas curtas e diretas — isso é uma chamada telefônica
- Sempre confirme o apartamento antes de acionar o morador
- Se o apartamento não existir no cadastro, informe educadamente
- Nunca invente informações — use apenas as funções disponíveis

Idioma: Português do Brasil.
`.trim();

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_morador',
      description: 'Busca as informações do morador pelo número do apartamento.',
      parameters: {
        type: 'object',
        properties: {
          apartamento: { type: 'string', description: 'Número do apartamento, ex: "101"' },
        },
        required: ['apartamento'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ligar_para_morador',
      description: 'Liga para o ramal SIP do morador e conecta com o porteiro.',
      parameters: {
        type: 'object',
        properties: {
          apartamento: { type: 'string', description: 'Número do apartamento' },
          motivo: { type: 'string', description: 'Motivo da chamada, ex: "entrega de encomenda"' },
        },
        required: ['apartamento', 'motivo'],
      },
    },
  },
];

export type ToolHandlers = Record<string, (args: Record<string, string>) => Promise<string>>;
export type Message = { role: 'user' | 'assistant'; content: string };

export async function askGPT(history: Message[], toolHandlers: ToolHandlers = {}): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
  ];

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 512,
      temperature: 0.7,
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    messages.push(msg as ChatCompletionMessageParam);

    // Resposta final de texto
    if (!msg.tool_calls?.length) {
      return msg.content?.trim() ?? '';
    }

    // Executa function calls
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments) as Record<string, string>;

      log.info({ tool: name, args }, 'GPT: acionou função');

      let result = 'Função não encontrada.';
      if (toolHandlers[name]) {
        try {
          result = await toolHandlers[name](args);
        } catch (err) {
          result = `Erro: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      log.info({ tool: name, result }, 'GPT: resultado da função');

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return 'Desculpe, ocorreu um problema. Pode repetir?';
}
