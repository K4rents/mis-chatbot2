import express from "express";
import axios from "axios";
import fs from "fs/promises"; 

// ----------------------------------------------------
// 1. CONFIGURACIÓN: Variables de Entorno y Constantes
// ----------------------------------------------------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Asegúrese de que estas variables de entorno estén configuradas en su servidor
const WASENDER_API = process.env.WASENDER_API;
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; 
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; 

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// 🚩 URLS DE MEDIOS DEFINITIVAS 🚩
const VIDEO_BIENVENIDA_URL = 'https://drive.google.com/file/d/1W90iW4nJy7pqvraA--FJTT_HQQw3h4uJ/view'; 

const PAUSA_ENTRE_MENSAJES = 6000; // 6 segundos
const MEMORY_FILE = 'welcome_memory.json'; 

// Control de concurrencia y contexto
const mensajesProcesados = new Set();

let bienvenidaEnviada = new Map(); 
const conversacionEnEscalamiento = new Map(); 

// Palabras clave de producto/compra (Usadas para detectar "información específica")
const palabrasProducto = ['modelo', 'talla', 'precio', 'vestido', 'falda', 'blusa', 'pantalón', 'pantalon', 'ropa', 'artículo', 'articulo', 'catalogo', 'stock', 'pedido', 'compra']; 
// Palabras críticas para escalamiento inmediato (Prioridad 0.0)
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 

// --- CONSTANTES DE MENSAJES ---
const mensajePago = 
    `*¡ANTICIPO O PAGO RÁPIDO!* 💰\n` +
    `Si deseas asegurar tu pedido o hacer un anticipo, puedes usar nuestros datos de Scotiabank:\n\n` +
    `*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez\n` + 
    `*🏦 BANCO:* Scotiabank\n` +
    `*CLABE:* **044320256058512878**\n` +
    `*Tarjeta:* **5579209154257585**\n\n` +
    `_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;
    
const mensajeEscalaCompleta = 
    `¡Excelente! 🛒 Con gusto te ayudo a finalizar tu compra. Estoy conectando tu conversación con una vendedora experta para confirmar stock, tallas y resolver cualquier duda. Te atenderán en breve. ¡Gracias! 😊\n\n${mensajePago}`;

// 🚩 MENSAJE PARA ESCALAMIENTO SUAVE DE ENVÍO (PRIORIDAD 0.5) 🚩
const mensajeEnvioEscalaSuave = 
    `¡Excelente! 📦 Con gusto te ayudo con los detalles de tu envío. Estoy conectando tu conversación con una vendedora experta para cotizar, confirmar cobertura y resolver cualquier duda. Te atenderán en breve. ¡Gracias! 😊`;
    
// MENSAJE COMBINADO DE REENGANCHE Y DINÁMICA (P1.5) 
const mensajeDinamicaVideo = 
    `Seguimos en línea para lo que necesites. 😊\n\n` +
    `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;
    
const mensajeSaludoExistente = 
    `¡Hola, bienvenida de nuevo! 😊 ¿En qué puedo ayudarte hoy? Recuerda que nuestra dinámica de compra está en este video: ${VIDEO_BIENVENIDA_URL}`;

const bienvenidaTextoParte1 = 
    `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨\n\n` +
    `¿Tienes tienda o te manejas sobre pedido?\n\n` + 
    `A continuación, te dejo nuestro link de nuestra página oficial: https://www.facebook.com/share/19928ADEfk/\n\n` + 
    mensajeDinamicaVideo; 

const bienvenidaTextoParte2 = 
    `¡Realiza tu **primera compra** y llévate un cupón! 🎁\n\n` +
    `1.-Cupón: Realiza una compra mínima de *$4000 MXN* se brinda el precio de corrida que son 10 pesos menos por prenda del precio de mayoreo\n\n` +
    `2.-Cupón: Realiza una compra mínima de *$6000 MXN* se brinda el precio de paquete que son 20 pesos menos por prenda del precio de mayoreo`;
    
// ----------------------------------------------------
// 2. SERVICIOS EXTERNOS Y UTILIDADES
// ----------------------------------------------------

/**
 * Persistencia: Carga la memoria del archivo.
 */
async function cargarMemoria() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        bienvenidaEnviada = new Map(parsed.bienvenidaEnviada);
        console.log(`✅ Memoria de bienvenida cargada. ${bienvenidaEnviada.size} clientes recurrentes.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📝 Archivo de memoria no encontrado. Creando uno nuevo.');
        } else {
            console.error('❌ Error al cargar memoria:', error.message);
        }
    }
}

/**
 * Persistencia: Guarda la memoria en el archivo.
 */
async function guardarMemoria() {
    try {
        const data = JSON.stringify({
            bienvenidaEnviada: Array.from(bienvenidaEnviada.entries())
        });
        await fs.writeFile(MEMORY_FILE, data, 'utf8');
        console.log('💾 Memoria de bienvenida guardada.');
    } catch (error) {
        console.error('❌ Error al guardar memoria:', error.message);
    }
}


/**
 * Utilidad: Remueve tildes y acentos de una cadena de texto.
 */
function stripAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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

/**
 * Utilidad: Envía el mensaje de Bienvenida Completa (Parte 1 y 2).
 */
async function enviarBienvenidaCompleta(numero) {
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    // --- MENSAJE DE BIENVENIDA (PRIMER PARTE) ---
    await enviarTextoWasender(numero, bienvenidaTextoParte1);
    
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    // --- MENSAJE DE OFERTA (SEGUNDA PARTE) ---
    await enviarTextoWasender(numero, bienvenidaTextoParte2);
    
    // Marca como enviado si es la primera vez
    if(!bienvenidaEnviada.has(numero)) {
        bienvenidaEnviada.set(numero, true);
        await guardarMemoria();
    }
}


async function obtenerRespuestaOpenRouter(mensaje, contexto) {
    try {
        const promptCompleto = [
            { 
                role: 'system', 
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

async function procesarMensajes(body) {
    
    if (body?.event === 'webhook.test') {
        console.log("✅ Webhook Test recibido y omitido.");
        return; 
    }
    
    let msg = body?.data?.messages;
    if (!msg) return;

    try {
        const resumen = "Tu rol es un asistente de ventas de ropa de Karen's Clothes."; 
        const mensajes = Array.isArray(msg) ? msg : [msg];

        for (const msgObj of mensajes) {
            const msgId = msgObj.key?.id;
            if (!msgId) continue;

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
            // 🚩 0.1 PRIORIDAD: LIMPIEZA Y NORMALIZACIÓN CRÍTICA DEL NÚMERO / BLOQUEO DE GRUPOS 🚩
            // -------------------------------------------
            
            const esGrupo = numeroRaw.endsWith('@g.us');
            if (esGrupo) {
                console.log(`❌ MENSAJE DE GRUPO DETECTADO Y BLOQUEADO: ${numeroRaw}`);
                continue; 
            }
            
            // 1. **Extracción y Limpieza Agresiva:**
            let numero = numeroRaw.replace(/[^0-9]/g, '');
            
            // 2. **Normalización CRÍTICA a 12 dígitos (521 + 10 dígitos) si es necesario:**
            
            if (numero.length === 10 && !numero.startsWith('52')) {
                // Caso A: Número normal de 10 dígitos. Lo normalizamos a 521.
                numero = '521' + numero;
                console.log(`✅ Número normalizado: Forzado a 521 + 10 dígitos -> ${numero}`);
            } else if (numero.length > 12 && numeroRaw.endsWith('@lid')) {
                // Caso B: Es un ID de Lista de Difusión (@lid). No se puede normalizar para el enlace.
                console.log(`⚠️ Alerta: ID de Lista de Difusión (@lid) detectado. No se puede normalizar el enlace wa.me.`);
            } else if (numero.length === 12 && numero.startsWith('521')) {
                // Caso C: Ya está en el formato correcto (ej: 5213320851591)
                console.log(`✅ Número ya normalizado: ${numero}`);
            }
            // -------------------------------------------

            const textoLower = texto.toLowerCase();
            const textoSinTildes = stripAccents(textoLower); 
            
            
            // -------------------------------------------
            // 🚩 0.0 PRIORIDAD MÁXIMA: DEVOLUCIONES / CAMBIOS (CRÍTICO) 🚩
            // -------------------------------------------
            const esTemaCritico = palabrasCriticas.some(keyword => textoSinTildes.includes(keyword));

            if (esTemaCritico) {
                console.log(`🚨 ESCALANDO CRÍTICO a humano por TEMA SENSIBLE/DEVOLUCIÓN: ${numero}`);
                await notificarSlack(numero, `TEMA CRÍTICO (Devolución/Cambio): "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                const respuestaCritica = 
                    `¡Lamento el inconveniente! 😔 Este es un tema sensible que debe ser manejado por un humano. \n\n` + 
                    `Ya hemos notificado a nuestro equipo de *Atención al Cliente* sobre tu *devolución/cambio*. \n` + 
                    `En breve una persona te atenderá para *recabar los datos necesarios* y ayudarte con el proceso.`;
                
                await enviarTextoWasender(numero, respuestaCritica);
                
                // Desbloquear la conversación
                conversacionEnEscalamiento.delete(numero);
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR PEDIDO CLARO / CONTACTO / IMAGEN / CONFIRMACIÓN DE PAGO 🚩
            // -------------------------------------------
            const buscaPedidoClaro = textoSinTildes.includes('quiero hacer un pedido') ||
                                     textoSinTildes.includes('hacer un pedido') ||
                                     textoSinTildes.includes('quiero comprar') ||
                                     textoSinTildes.includes('para comprar') ||
                                     textoSinTildes.includes('compraria') ||
                                     textoSinTildes.includes('dame el precio') ||
                                     // Temas de Venta Directa (ENVIO FUE REMOVIDO Y MOVIDO A P0.5)
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('cuanto') ||
                                     // Comandos y Solicitudes de Personal
                                     textoSinTildes.includes('contactar a la persona') || 
                                     textoSinTildes.includes('como contacto') ||          
                                     textoSinTildes.includes('quiero hablar con') ||     
                                     textoSinTildes.includes('dame un asesor') ||
                                     textoSinTildes.includes('escalame') || 
                                     textoSinTildes.includes('escalar') ||  
                                     textoSinTildes.includes('vendedora') ||
                                     textoSinTildes.includes('vendedor') || 
                                     textoSinTildes.includes('asesor') ||
                                     textoSinTildes === 'si' ||
                                     textoSinTildes.includes('tienda') || 
                                     textoSinTildes.includes('sobre pedido') ||
                                     textoSinTildes.includes('manejo pedido') ||
                                     // --- PALABRAS CLAVE CRÍTICAS DE CONFIRMACIÓN DE PAGO ---
                                     textoSinTildes.includes('comprobante') ||
                                     textoSinTildes.includes('captura') ||         
                                     textoSinTildes.includes('transferencia');
                                     


            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar') || textoSinTildes.includes('pago')) 
            );

            if (esImagenDePedido || buscaPedidoClaro) {
                console.log(`🚨 ESCALANDO a humano por intencion de COMPRA/CONTACTO/SEGMENTACIÓN CLARA de ${numero}.`);
                await notificarSlack(numero, `INTENCIÓN DE COMPRA/CONTACTO/SEGMENTACIÓN: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // Usar el mensaje completo y estandarizado
                await enviarTextoWasender(numero, mensajeEscalaCompleta);
                
                // Desbloquear la conversación
                conversacionEnEscalamiento.delete(numero); 
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0.5 PRIORIDAD: ESCALAMIENTO SUAVE POR ENVÍO (SIN DINERO) 🚩
            // -------------------------------------------
            const buscaEnvio = textoSinTildes.includes('envio') || textoSinTildes.includes('estafeta') || textoSinTildes.includes('paqueteria');
            
            if (buscaEnvio) {
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de ENVÍO/LOGÍSTICA: ${numero}.`);
                await notificarSlack(numero, `PREGUNTA SOBRE ENVÍO/LOGÍSTICA: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // Usar el mensaje suave sin datos de pago
                await enviarTextoWasender(numero, mensajeEnvioEscalaSuave);
                
                // Marcar como atendido si es nuevo
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                conversacionEnEscalamiento.delete(numero); 
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.5 PRIORIDAD: DESCARTE POR CIERRE O AGRADECIMIENTO (Incluye reenganche) 🚩
            // -------------------------------------------
            
            const buscaCierre = textoSinTildes.includes('gracias') ||
                                textoSinTildes.includes('bye') ||
                                textoSinTildes.includes('saludos') ||
                                textoSinTildes === 'ok' || 
                                textoSinTildes === 'va' || 
                                textoSinTildes === 'vale' || 
                                textoSinTildes === 'sale' || 
                                textoSinTildes.includes('está bien') || 
                                textoSinTildes.includes('esta bien'); 

            if (buscaCierre && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Mensaje de cierre/agradecimiento/acuse de recibo detectado de ${numero}. Invitando a ver dinámica con reenganche.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // Envía el mensaje combinado (reenganche + video)
                await enviarTextoWasender(numero, mensajeDinamicaVideo);
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (MENSAJE CORTO) 🚩
            // -------------------------------------------
            
            const esSaludoSimple = textoSinTildes.includes('hola') || 
                                   textoSinTildes.includes('hi') ||
                                   textoSinTildes.includes('buenos dias') ||
                                   textoSinTildes.includes('buenas tardes') ||
                                   textoSinTildes.includes('buenas');
            
            if (esSaludoSimple && bienvenidaEnviada.has(numero) && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Saludo simple de número EXISTENTE. Enviando saludo recurrente y video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeSaludoExistente);
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.1 PRIORIDAD: INFORMES (BIFURCACIÓN GENÉRICO vs. ESPECÍFICO) 🚩
            // -------------------------------------------
            const buscaInformesGenerico = textoSinTildes.includes('informes') || 
                                          textoSinTildes.includes('informacion') ||
                                          textoSinTildes.includes('info') || // <-- CORRECCIÓN AÑADIDA
                                          textoSinTildes.includes('tienes informacion');

            const esEspecifico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));

            if (buscaInformesGenerico && esEspecifico) {
                // SCENARIO A: INFORMACIÓN ESPECÍFICA (Escalada: Producto, Precio, Talla, Pedido, etc.)
                console.log(`🚨 ESCALANDO (P1.1 ESPECÍFICO) a humano por solicitud de INFORMES ESPECÍFICOS: ${numero}.`);
                await notificarSlack(numero, `PIDE INFORMES ESPECÍFICOS (Producto/Pedido): "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // Usar el mensaje completo de Escalada
                await enviarTextoWasender(numero, mensajeEscalaCompleta);
                
                // Marcar como atendido si es nuevo
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                conversacionEnEscalamiento.delete(numero); 
                continue; 
                
            } else if (buscaInformesGenerico) {
                // SCENARIO B: INFORMACIÓN GENÉRICA (Forzar Bienvenida Completa)
                console.log(`[FLOW] Solicitud de INFORMES/INFORMACION GENÉRICA detectada de ${numero}. Enviando Bienvenida Completa.`);
                
                await enviarBienvenidaCompleta(numero); 
                
                conversacionEnEscalamiento.delete(numero); 
                continue; 
            }

            
            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO (RESPUESTA RÁPIDA - NO ESCALA) 🚩
            // -------------------------------------------
            
            // LÓGICA DE PAGO (Con corrección de 'transfiero' / 'transferir')
            const buscaPago = textoSinTildes.includes('pago') || textoSinTildes.includes('anticipo') || 
                              textoSinTildes.includes('scotiabank') || textoSinTildes.includes('transferencia') ||
                              textoSinTildes.includes('transfiero') || 
                              textoSinTildes.includes('transferir') || 
                              textoSinTildes.includes('deposito') || textoSinTildes.includes('cuenta');
            
            // LÓGICA DE DINÁMICA/VIDEO - Captura preguntas de "cómo" o "proceso" 
            const buscaDinamica = textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('como se realiza') ||
                                   textoSinTildes.includes('realizo una compra') ||
                                   textoSinTildes.includes('como') || 
                                   textoSinTildes.includes('proceso') || 
                                   textoSinTildes.includes('realizo') ||
                                   textoSinTildes.includes('hago');
                  
            if (buscaPago || buscaDinamica) {
                console.log(`[FLOW] Solicitud de Pago/Dinamica/Instrucciones de ${numero}.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                if (buscaPago) await enviarTextoWasender(numero, mensajePago);
                if (buscaDinamica) await enviarTextoWasender(numero, mensajeDinamicaVideo);
                
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                conversacionEnEscalamiento.delete(numero); 
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 3. PRIORIDAD: LÓGICA DE BIENVENIDA COMPLETA (CLIENTE NUEVO - DEFAULT) 🚩
            // -------------------------------------------
            
            if (!bienvenidaEnviada.has(numero)) { 
                console.log(`[FLOW] Cliente NUEVO (DEFAULT). Enviando flujo de bienvenida COMPLETA.`);
                
                await enviarBienvenidaCompleta(numero); 
                
                continue;
            }


            // -------------------------------------------
            // 🚩 4. Lógica de Respuesta Normal / IA / Escalada (Default)
            // -------------------------------------------

            let respuesta;
            let escalarAHumano = false;
            
            // 1. Obtener respuesta de la IA
            const respuestaIA = await obtenerRespuestaOpenRouter(texto, resumen);

            if (respuestaIA.includes("COMANDO_ESCALAR") || respuestaIA.includes("COMANDO_ESCALAR_FALLO")) {
                escalarAHumano = true;
            } else {
                // 2. Refuerzo: Revisar la pregunta por Keywords (modelos, talla, etc.)
                if (palabrasProducto.some(keyword => textoSinTildes.includes(keyword))) {
                    console.log(`🚨 ESCALANDO FORZADO: La IA falló o no dio COMANDO, pero la pregunta (${texto}) contiene Keywords de producto/compra.`);
                    escalarAHumano = true;
                }
            }
            
            if (escalarAHumano) {
                console.log(`🚨 ESCALANDO a humano por solicitud de producto/compra: ${numero}`);
                await notificarSlack(numero, texto);
                
                // Usar el mensaje completo y estandarizado
                respuesta = mensajeEscalaCompleta; 
                
                // Desbloquear la conversación
                conversacionEnEscalamiento.delete(numero); 

            } else {
                // 3. Si no escaló, enviar la respuesta de la IA (solo para saludos o preguntas muy genéricas)
                respuesta = respuestaIA;
                conversacionEnEscalamiento.delete(numero); 
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
    // 🚩 CRÍTICO: Cargar la memoria al iniciar
    await cargarMemoria(); 
    console.log(`🤖 Chatbot activo en puerto ${PORT}.`);
});
