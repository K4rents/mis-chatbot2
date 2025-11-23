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

// Palabras clave de producto/compra 
const palabrasProducto = ['modelo', 'talla', 'precio', 'vestido', 'falda', 'blusa', 'pantalón', 'pantalon', 'ropa', 'artículo', 'articulo', 'catalogo', 'stock', 'pedido', 'compra']; 
// Palabras críticas para escalamiento inmediato (Prioridad 0.0)
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 

// --- CONSTANTES DE MENSAJES (OPTIMIZADAS CON TONO DE CONFIANZA) ---

const mensajePago = 
    `*¡ANTICIPO O PAGO RÁPIDO!* 💰\n` +
    `Si deseas asegurar tu pedido o hacer un anticipo, puedes usar nuestros datos de Scotiabank:\n\n` +
    `*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez\n` + 
    `*🏦 BANCO:* Scotiabank\n` +
    `*CLABE:* **044320256058512878**\n` +
    `*Tarjeta:* **5579209154257585**\n\n` +
    `_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;
    
// --- MENSAJE DE ESCALAMIENTO MÁXIMO (P0) ---
const mensajeEscalaCompleta = 
    `¡Excelente! 🛒 Ya te estoy enlazando con nuestra *vendedora experta* para finalizar tu compra. Ella confirmará *stock*, *tallas* y resolverá cualquier duda. ¡Te atenderán de inmediato! 😊\n\n${mensajePago}`;

// --- MENSAJE PARA ESCALAMIENTO SUAVE DE ENVÍO (P0.5) ---
const mensajeEnvioEscalaSuave = 
    `¡Excelente! 📦 Ya te estoy enlazando con nuestra *vendedora experta*. Ella cotizará el *envío* y confirmará la cobertura. ¡Te atenderán de inmediato! 😊`;

// --- MENSAJE PARA ESCALAMIENTO SUAVE DE PRODUCTO (P0.6) ---
const mensajeProductoEscalaSuave = 
    `¡Excelente! 👕 Ya te estoy enlazando con nuestra *vendedora experta*. Ella confirmará el *stock* y *talla* o resolverá cualquier otra duda que tengas. ¡Te atenderán de inmediato! 😊`;
    
// MENSAJE DINÁMICA DE VIDEO (P2)
const mensajeDinamicaVideo = 
    `Seguimos en línea para lo que necesites. 😊\n\n` +
    `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;

// MENSAJE DE CIERRE PURO (P1.5) - MODIFICADO
const mensajeCierrePuro = 
    `Seguimos en línea para lo que necesites. 😊`;
    
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

async function enviarBienvenidaCompleta(numero) {
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    await enviarTextoWasender(numero, bienvenidaTextoParte1);
    
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    await enviarTextoWasender(numero, bienvenidaTextoParte2);
    
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
            
            let numero = numeroRaw.replace(/[^0-9]/g, '');
            
            if (numero.length === 10 && !numero.startsWith('52')) {
                numero = '521' + numero;
                console.log(`✅ Número normalizado: Forzado a 521 + 10 dígitos -> ${numero}`);
            } else if (numero.length === 12 && numero.startsWith('521')) {
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
                
                conversacionEnEscalamiento.delete(numero);
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO (RESPUESTA RÁPIDA - SOLO DATOS/VIDEO) 🚩
            // -------------------------------------------
            
            const buscaPagoDatos = textoSinTildes.includes('scotiabank') || 
                              textoSinTildes.includes('transferencia') ||
                              textoSinTildes.includes('transfiero') || 
                              textoSinTildes.includes('transferir') || 
                              textoSinTildes.includes('deposito') || 
                              textoSinTildes.includes('cuenta');
            
            const buscaDinamica = textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('como se realiza') ||
                                   textoSinTildes.includes('realizo una compra') ||
                                   textoSinTildes.includes('como') || 
                                   textoSinTildes.includes('proceso') || 
                                   textoSinTildes.includes('realizo') ||
                                   textoSinTildes.includes('hago') ||
                                   textoSinTildes.includes('hacer un pedido');
                                   
            // Redefinición de P0 para ser usada como negación.
            const buscaPedidoClaro = textoSinTildes.includes('quiero hacer un pedido') || 
                                     textoSinTildes.includes('quiero comprar') ||
                                     textoSinTildes.includes('para comprar') ||
                                     textoSinTildes.includes('compraria') ||
                                     textoSinTildes.includes('dame el precio') ||
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('cuanto') ||
                                     textoSinTildes.includes('pago') || 
                                     textoSinTildes.includes('pagar') || 
                                     textoSinTildes.includes('contactar a la persona') || 
                                     textoSinTildes.includes('quiero hablar con') ||     
                                     textoSinTildes.includes('asesor') ||
                                     textoSinTildes === 'si' ||
                                     textoSinTildes.includes('tienda') || 
                                     textoSinTildes.includes('sobre pedido') ||
                                     textoSinTildes.includes('comprobante') ||
                                     textoSinTildes.includes('captura');
                                     

                  
            if ((buscaPagoDatos && !buscaPedidoClaro) || buscaDinamica) { 
                console.log(`[FLOW] Solicitud de Pago/Dinamica/Instrucciones de ${numero}.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                if (buscaPagoDatos && !buscaPedidoClaro) await enviarTextoWasender(numero, mensajePago);
                if (buscaDinamica) await enviarTextoWasender(numero, mensajeDinamicaVideo);
                
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                conversacionEnEscalamiento.delete(numero); 
                continue; 
            }


            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR PEDIDO CLARO / CONTACTO / IMAGEN / CONFIRMACIÓN DE PAGO 🚩
            // -------------------------------------------
            // *** NOTA: La variable 'buscaPedidoClaro' ya está definida arriba para consistencia. ***
            
            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar') || textoSinTildes.includes('pago')) 
            );

            if (esImagenDePedido || buscaPedidoClaro) {
                console.log(`🚨 ESCALANDO a humano por intencion de COMPRA/CONTACTO/SEGMENTACIÓN CLARA de ${numero}.`);
                await notificarSlack(numero, `INTENCIÓN DE COMPRA/CONTACTO/SEGMENTACIÓN: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeEscalaCompleta);
                
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
                
                await enviarTextoWasender(numero, mensajeEnvioEscalaSuave);
                
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                conversacionEnEscalamiento.delete(numero); 
                continue; 
            }

            // -------------------------------------------
            // 🚩 0.6 PRIORIDAD: ESCALAMIENTO SUAVE POR PRODUCTO/TALLA (SIN DINERO) 🚩
            // -------------------------------------------
            const buscaProductoGenerico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));
            
            if (buscaProductoGenerico) {
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de PRODUCTO/TALLA/PRECIO (P0.6): ${numero}.`);
                await notificarSlack(numero, `PREGUNTA SOBRE PRODUCTO/TALLA/PRECIO: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeProductoEscalaSuave);
                
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
                console.log(`[FLOW] Mensaje de cierre/agradecimiento/acuse de recibo detectado de ${numero}. Enviando cierre simple.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // ===> USA EL MENSAJE PURO Y SIMPLE <===
                await enviarTextoWasender(numero, mensajeCierrePuro);
                
                continue; 
            }
            
            // -------------------------------------------
            // 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (MENSAJE CORTO) 
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
                                          textoSinTildes.includes('info') || 
                                          textoSinTildes.includes('tienes informacion');

            const esEspecifico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));

            if (buscaInformesGenerico && esEspecifico) {
                // SCENARIO A: INFORMACIÓN ESPECÍFICA (Escalada suave de producto)
                console.log(`🚨 ESCALANDO (P1.1 ESPECÍFICO) a humano por solicitud de INFORMES ESPECÍFICOS: ${numero}.`);
                await notificarSlack(numero, `PIDE INFORMES ESPECÍFICOS (Producto/Pedido): "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeProductoEscalaSuave);
                
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
            
            const respuestaIA = await obtenerRespuestaOpenRouter(texto, resumen);

            if (respuestaIA.includes("COMANDO_ESCALAR") || respuestaIA.includes("COMANDO_ESCALAR_FALLO")) {
                escalarAHumano = true;
            } else {
                if (palabrasProducto.some(keyword => textoSinTildes.includes(keyword))) {
                    console.log(`🚨 ESCALANDO FORZADO (P4 Fallback): La IA falló, pero la pregunta (${texto}) contiene Keywords de producto/compra.`);
                    escalarAHumano = true;
                }
            }
            
            if (escalarAHumano) {
                console.log(`🚨 ESCALANDO a humano por solicitud de producto/compra (P4): ${numero}`);
                await notificarSlack(numero, texto);
                
                respuesta = mensajeProductoEscalaSuave; 
                
                conversacionEnEscalamiento.delete(numero); 

            } else {
                respuesta = respuestaIA;
                conversacionEnEscalamiento.delete(numero); 
            }
            
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
// 4. WEBHOOK PRINCIPAL 
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
    await cargarMemoria(); 
    console.log(`🤖 Chatbot activo en puerto ${PORT}.`);
});
