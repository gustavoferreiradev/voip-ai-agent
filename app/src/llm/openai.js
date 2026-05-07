// src/llm/openai.js
// Envia histórico de conversa para o GPT-4o e retorna a resposta em texto
import OpenAI from 'openai';
import { log } from '../logger.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
Você é um assistente de atendimento telefônico inteligente.
Responda de forma clara, objetiva e natural, como em uma ligação telefônica.
Evite markdown, listas ou formatação especial – use apenas texto corrido.
Seja conciso: respostas de no máximo 3 frases, a menos que o usuário peça detalhes.
Idioma: Português do Brasil.
`.trim();

/**
 * @param {Array<{role: 'user'|'assistant', content: string}>} history
 * @returns {Promise<string>}
 */
export async function askGPT(history) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
    ];

    log.debug({ messages }, 'Enviando para GPT-4o');

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: 256,
        temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content ?? '';
    return text.trim();
}