import express from "express";
import axios from "axios";

// ----------------------------------------------------
// 1. CONFIGURACIÓN: Variables de Entorno y Constantes
// ----------------------------------------------------
const app = express();
app.use(express.json());

// Variables cargadas desde process.env (Render.com)
const PORT = process.env.PORT || 10000;

// [INICIO BLOQUE COMENTADO - WOOCOMMERCE]
/*
const WP_URL = process.env.WP_URL;
const WC_KEY = process.env.WC_KEY;
const WC_SECRET = process.env.WC_SECRET;
*/
// [FIN BLOQUE COMENTADO - WOOCOMMERCE]

const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; 
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; 

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// 🚩 URLS DE MEDIOS DEFINITIVAS 🚩
const VIDEO_BIENVENIDA_URL = 'https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view'; 
const URL_MECANICA_COMPRA = 'https://drive.google.com/file/d/163YfomYIO9JojMvQGy7VUa0EkV1tXKLe/view?usp=sharing'; 

const PAUSA_ENTRE_MENSAJES = 6000; // 6 segundos (para evitar el error anti-flood de Wasender)

// Control de concurrencia y contexto (PERSISTENCIA V33)
const mensajesProcesados = new Set();
const contextoProductoUsuario = new Map();
const respuestaCorta = ['sí', 'si', 'ok', 'claro', 'chica', 'chico', 's', 'okey', 'vale', 'va'];

// [INICIO BLOQUE COMENTADO - CACHE DE PRODUCTOS]
/*
let cacheProductos = [];
let ultimaActualizacion = 0;
const TIEMPO_CACHE = 1000 * 60 * 60 * 4; // 4 horas
*/
// [FIN BLOQUE COMENTADO - CACHE DE PRODUCTOS]

// ----------------------------------------------------
// 2. SERVICIOS EXTERNOS Y UTILIDADES
// ----------------------------------------------------

/**
 * Utilidad: Remueve tildes y acentos de una cadena de texto.
 */
function stripAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Servicio: Enviar un mensaje (Texto) a través de Wasender.
 */
async function enviarTextoWasender(numero, text) {
    try {
        await axios.post(WASENDER_API, {
            to: numero,
            text: text
        }, {
            headers: { 'Authorization': `Bearer ${WASENDER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`💬 Mensaje de texto enviado a ${numero}. Respuesta: ${text.substring(0, 50)}...`);
    } catch (error) {
        console.error('❌ Error al enviar mensaje de texto:', error.response?.data || error.message);
    }
}

/**
 * Servicio: Enviar una imagen a través de Wasender.
 */
async function enviarImagenWasender(numero, url, caption = '') {
    try {
        await axios.post(WASENDER_API, {
            to: numero,
            image: { url: url }, 
            caption: caption      
        }, {
            headers: { 'Authorization': `Bearer ${WASENDER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`🖼️ Imagen enviada a ${numero}.`);
        return true; 
    } catch (error) {
        console.error('❌ Fallo al enviar imagen:', error.response?.data || error.message);
        return false; 
    }
}


/**
 * Función que ya no se usa, pero se mantiene para claridad.
 */
async function enviarVideoComoImagen(numero, url, caption) {
    return false;
}


/**
 * Servicio: Notificación a Slack (Escalamiento a Humano).
 */
async function notificarSlack(numero, mensajeCliente) {
    if (!SLACK_WEBHOOK_URL) {
        console.error('❌ SLACK_WEBHOOK_URL no configurada. No se pudo escalar.');
        return;
    }

    const WA_LINK = `https://wa.me/${numero}`; 
    const alertaTextoSinFormato = 
        `🚨 @channel *ESCALAMIENTO HUMANO REQUERIDO*\n\n` + 
        `*Cliente:* ${numero}\n` + 
        `*Mensaje:* "${mensajeCliente}"\n\n` +
        `_Haga clic aquí para abrir el chat en WhatsApp._`;

    const slackLink = `<${WA_LINK}|${alertaTextoSinFormato.replace(/\n/g, ' ')}>`;

    const slackPayload = {
        text: slackLink,
        username: 'Boutique Bot Alerta',
        icon_emoji: ':robot_face:',
    };
    
    try {
        await axios.post(SLACK_WEBHOOK_URL, slackPayload);
        console.log('✅ Alerta de escalamiento enviada a Slack con enlace wa.me.');
    } catch (error) {
        console.error('❌ Error al notificar Slack:', error.message);
    }
}

// [INICIO BLOQUE COMENTADO - FUNCIONES DE WOOCOMMERCE]
/*
async function obtenerProductosConCache() {
// ...
}

function generarResumenProductos(productos) {
// ...
}
*/
// [FIN BLOQUE COMENTADO - FUNCIONES DE WOOCOMMERCE]


/**
 * Servicio: Obtener respuesta de OpenRouter (GPT-4o-mini).
 */
async function obtenerRespuestaOpenRouter(mensaje, contexto) {
    try {
        const promptCompleto = [
            { 
                role: 'system', 
                // CRÍTICO: Se ajusta el prompt para escalar inmediatamente al tener preguntas de producto.
                content: `Eres un asistente de ventas de ropa para una boutique online llamada Karen's Clothes. Tu objetivo es conectar al cliente con un humano para cualquier consulta de producto, talla, precio o compra. Si el usuario te pregunta por cualquier producto (ej. "vestido", "falda", "precio", "talla"), o si la pregunta implica una decisión de compra inmediata, responde *solamente* con el texto: "COMANDO_ESCALAR". Para cualquier otro saludo o pregunta no relacionada a producto, da una respuesta amable.` 
            },
            { role: 'system', content: contexto },
            { role: 'user', content: mensaje }
        ];

        const response = await axios.post(OPENROUTER_API_URL, {
            model: 'gpt-4o-mini',
            messages: promptCompleto
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('❌ Error OpenRouter:', error.response?.data || error.message);
        return "COMANDO_ESCALAR_FALLO";
    }
}

// ----------------------------------------------------
// 3. LÓGICA PRINCIPAL DEL BOT (Asíncrona)
// ----------------------------------------------------

/**
 * Función principal que procesa la lógica pesada sin bloquear el webhook.
 */
async function procesarMensajes(body) {
    
    if (body?.event === 'webhook.test') {
        console.log("✅ Webhook Test recibido y omitido.");
        return; 
    }
    
    let msg = body?.data?.messages;
    if (!msg) return;

    try {
        const resumen = "Tu rol es un asistente de ventas de ropa de Karen's Clothes."; // Contexto genérico para la IA
        const mensajes = Array.isArray(msg) ? msg : [msg];

        for (const msgObj of mensajes) {
            const msgId = msgObj.key?.id;
            if (!msgId) continue;

            // Bloque de persistencia para evitar duplicados
            if (mensajesProcesados.has(msgId)) {
                continue;
            }
            mensajesProcesados.add(msgId);

            if (!msgObj.message || msgObj.key.fromMe) continue;

            let texto = '';
            if (msgObj.message?.conversation) texto = msgObj.message.conversation;
            else if (msgObj.message?.extendedTextMessage?.text) texto = msgObj.message.extendedTextMessage.text;
            else if (msgObj.message?.imageMessage?.caption) texto = msgObj.message.imageMessage.caption;

            const numeroRaw = msgObj.key?.remoteJid || msgObj.remoteJid;
            if (!texto || !numeroRaw) continue;


            // -------------------------------------------
            // 🚩 0.1 PRIORIDAD: BLOQUEO DE GRUPOS Y NORMALIZACIÓN 🚩
            // -------------------------------------------
            
            // Un JID de grupo SIEMPRE termina en '@g.us'.
            if (numeroRaw.endsWith('@g.us')) {
                console.log(`❌ MENSAJE DE GRUPO DETECTADO Y BLOQUEADO: ${numeroRaw}`);
                continue; // ⬅️ Detiene el procesamiento de este mensaje
            }
            
            // ⬅️ Normalización SIMPLE (QUITAMOS el sufijo para obtener el número puro)
            let numero = numeroRaw.replace(/@s\.whatsapp\.net$/, '');
            
            // Re-normalización de 10 dígitos (seguridad para mensajes salientes)
            // Esto asegura que cualquier número de 10 dígitos (local) se convierta a 521XXXXXXXXXX
            numero = numero.replace(/[^0-9]/g, '');
            if (numero.length === 10 && !numero.startsWith('52')) {
                numero = '521' + numero;
                console.log(`✅ Número normalizado: Forzado a 521 + 10 dígitos -> ${numero}`);
            } 
            
            // -------------------------------------------

            const textoLower = texto.toLowerCase();
            
            // 🔥 CRÍTICO: Texto sin tildes para comparación precisa de keywords
            const textoSinTildes = stripAccents(textoLower); 
            
            // --- CONSTANTE PARA EL MENSAJE DE PAGO (CON NOMBRE DE BENEFICIARIO) ---
            const mensajePago = 
                `*¡ANTICIPO O PAGO RÁPIDO!* 💰\n` +
                `Si deseas asegurar tu pedido o hacer un anticipo, puedes usar nuestros datos de Scotiabank:\n\n` +
                `*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez\n` + 
                `*🏦 BANCO:* Scotiabank\n` +
                `*CLABE:* **044320256058512878**\n` +
                `*Tarjeta:* **5579209154257585**\n\n` +
                `_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;
                
            // --- CONSTANTE PARA EL MENSAJE DE DINÁMICA/VIDEO ---
            const mensajeDinamicaVideo = 
                `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;
            
            // --- CONSTANTE PARA SALUDO DE NÚMEROS EXISTENTES ---
            const mensajeSaludoExistente = `¡Hola, bienvenida de nuevo! 😊 ¿En qué puedo ayudarte hoy? Recuerda que nuestra dinámica de compra está en este video: ${VIDEO_BIENVENIDA_URL}`;
            
            // CLAVE DE CONTROL DE BIENVENIDA
            const bienvenidaKey = `bienvenida_enviada_${numero}`;


            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR IMAGEN DE PEDIDO 🚩
            // -------------------------------------------
            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar'))
            );

            if (esImagenDePedido) {
                console.log(`🚨 ESCALANDO a humano por recepción de IMAGEN de pedido de ${numero}.`);
                await notificarSlack(numero, `IMAGEN DE PEDIDO RECIBIDA: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                const respuestaEscala = `¡Recibido! 📦 Ya tenemos tu imagen con el pedido. Estoy conectando tu conversación con una vendedora experta para confirmar stock, tallas y método de pago. Te atenderán en breve. ¡Gracias! 😊\n\n${mensajePago}`;
                await enviarTextoWasender(numero, respuestaEscala);
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (EL QUE CHATEÓ ANTES) 🚩
            // -------------------------------------------
            
            // Si el mensaje es un saludo simple o muy corto
            const esSaludoSimple = textoSinTildes.includes('hola') || 
                                   textoSinTildes.includes('hi') ||
                                   textoSinTildes.includes('buenos dias') ||
                                   textoSinTildes.includes('buenas tardes') ||
                                   textoSinTildes.includes('buenas') ||
                                   textoSinTildes.length < 10; 
            
            // **CRÍTICO:** Solo entra aquí si el mensaje es un saludo SIMPLE Y YA ESTÁ EN MEMORIA.
            if (esSaludoSimple && mensajesProcesados.has(bienvenidaKey)) {
                console.log(`[FLOW] Saludo simple de número EXISTENTE. Enviando saludo recurrente y video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeSaludoExistente);
                
                continue; 
            }

            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO (RESPUESTA RÁPIDA) 🚩
            // -------------------------------------------
            
            // LÓGICA DE PAGO (USANDO textoSinTildes)
            const buscaPago = textoSinTildes.includes('pago') || 
                              textoSinTildes.includes('oago') || 
                              textoSinTildes.includes('anticipo') || 
                              textoSinTildes.includes('scotiabank') || 
                              textoSinTildes.includes('scotia') ||
                              textoSinTildes.includes('deposito') || 
                              textoSinTildes.includes('transferir') || 
                              textoSinTildes.includes('transferencia') || 
                              textoSinTildes.includes('cuenta') || 
                              textoSinTildes.includes('cual cuenta') ||
                              textoSinTildes.includes('dinero') || 
                              textoSinTildes.includes('envio'); 
                              
            if (buscaPago) {
                console.log(`[FLOW] Solicitud de información de PAGO de ${numero}.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajePago);
                
                // Marcamos como "bienvenido" si pide pago/dinámica.
                mensajesProcesados.add(bienvenidaKey);
                continue; 
            }
            
            // LÓGICA DE DINÁMICA/COMPRA (USANDO textoSinTildes):
            const buscaDinamica = textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('como comprar') || 
                                   textoSinTildes.includes('como se realiza') ||
                                   textoSinTildes.includes('realizo una compra') ||
                                   textoSinTildes.includes('como') || 
                                   textoSinTildes.includes('proceso') || 
                                   textoSinTildes.includes('realizo') || 
                                   textoSinTildes.includes('pedido') || 
                                   textoSinTildes.includes('orden') || 
                                   textoSinTildes.includes('comprar');
            
            if (buscaDinamica) {
                console.log(`[FLOW] Solicitud de Mecánica/Dinámica de ${numero}. Reenviando enlace del video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeDinamicaVideo);
                
                // Marcamos como "bienvenido" si pide pago/dinámica.
                mensajesProcesados.add(bienvenidaKey);
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 3. PRIORIDAD: LÓGICA DE BIENVENIDA COMPLETA (SOLO CLIENTE NUEVO O REINICIADO) 🚩
            // -------------------------------------------
            
            // Si el mensaje pasó por P1 y NO estaba en memoria, se asume que es nuevo (o un reset)
            if (!mensajesProcesados.has(bienvenidaKey)) { 
                console.log(`[FLOW] Cliente NUEVO o Reiniciado. Enviando flujo de bienvenida COMPLETA.`);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // --- MENSAJE DE BIENVENIDA (PRIMER PARTE) ---
                const bienvenidaTextoParte1 = 
                    `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨\n\n` +
                    `¿Tienes tienda o te manejas sobre pedido?\n\n` +
                    `A continuación, te dejo nuestro link de nuestra página oficial: https://www.facebook.com/share/19928ADEfk/\n\n` + 
                    mensajeDinamicaVideo; 

                await enviarTextoWasender(numero, bienvenidaTextoParte1);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // --- MENSAJE DE OFERTA (SEGUNDA PARTE - ACTUALIZADO) ---
                const bienvenidaTextoParte2 = 
                    `¡Realiza tu **primera compra** y llévate un cupón! 🎁\n\n` +
                    `1.-Cupón: Realiza una compra mínima de *$4000 MXN* se brinda el precio de corrida que son 10 pesos menos por prenda del precio de mayoreo\n\n` +
                    `2.-Cupón: Realiza una compra mínima de *$6000 MXN* se brinda el precio de paquete que son 20 pesos menos por prenda del precio de mayoreo`;
                
                await enviarTextoWasender(numero, bienvenidaTextoParte2);
                
                // CRÍTICO: Registramos la bienvenida para que la P1 funcione después
                mensajesProcesados.add(bienvenidaKey); 
                continue;
            }


            // -------------------------------------------
            // 🚩 4. Lógica de Respuesta Normal / IA / Escalada (Default)
            // -------------------------------------------

            let respuesta;
            
            // Si el cliente no cayó en P1, P2 o P3 (es existente y pregunta algo que no es dinàmica/pago)
            const respuestaIA = await obtenerRespuestaOpenRouter(texto, resumen);

            if (respuestaIA.includes("COMANDO_ESCALAR") || respuestaIA.includes("COMANDO_ESCALAR_FALLO")) {
                console.log(`🚨 ESCALANDO a humano por solicitud de producto/compra: ${numero}`);
                await notificarSlack(numero, texto);
                
                let mensajeEscalaBase = `¡Claro! Permíteme un momento, estoy conectando tu conversación con una vendedora experta. En breve te atenderán personalmente para ayudarte con stock, tallas, y método de pago. ¡Gracias! 😊`;
                
                if (buscaPago) {
                    respuesta = mensajeEscalaBase + '\n\n' + mensajePago;
                } else {
                    respuesta = mensajeEscalaBase;
                }

            } else {
                // Si la IA no escaló, simplemente responde amablemente.
                respuesta = respuestaIA;
                contextoProductoUsuario.delete(numero); 
            }
            
            // Enviar respuesta final
            if (respuesta) {
                 await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES)); 
                 await enviarTextoWasender(numero, respuesta);
            }
        }
    } catch (e) {
        console.error('❌ Error general en procesarMensajes:', e.message);
    }
}

// ----------------------------------------------------
// 4. WEBHOOK PRINCIPAL (Respuesta Inmediata y Verificación)
// ----------------------------------------------------

app.get('/', (req, res) => {
    res.send('Chatbot is running! PORT: ' + PORT);
});


app.post('/webhook', (req, res) => {
    
    res.sendStatus(200);

    procesarMensajes(req.body)
        .catch(error => console.error('❌ Fallo fatal en el pipeline del mensaje:', error));
});

// ----------------------------------------------------
// 5. INICIO DEL SERVIDOR
// ----------------------------------------------------

app.listen(PORT, async () => {
    console.log(`🤖 Chatbot activo en puerto ${PORT}.`);
});
