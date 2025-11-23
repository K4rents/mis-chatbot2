// preguntas.js
import axios from "axios";

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function obtenerRespuestaOpenRouter(mensaje, contexto, apiKey) {
  try {
    const promptCompleto = [
      { role: 'system', content: 'Eres un asistente de ventas de ropa para una boutique online de mujer.' },
      { role: 'system', content: contexto },
      { role: 'user', content: mensaje }
    ];

    const response = await axios.post(OPENROUTER_API_URL, {
      model: 'gpt-4o-mini',
      messages: promptCompleto
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ Error OpenRouter:', error.response?.data || error.message);
    return "Lo siento, ahora mismo no puedo responder eso.";
  }
}
