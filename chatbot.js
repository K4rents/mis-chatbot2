import express from "express";
import axios from "axios";
import fs from "fs/promises"; 

// ----------------------------------------------------
// 1. CONFIGURACIÓN: Variables de Entorno y Constantes
// ----------------------------------------------------
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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
const palabrasProducto = ['modelo', 'talla', 'precio', 'vestido', 'falda', 'blusa', 'pantalón', 'pantalon', 'ropa', 'artículo', 'articulo', 'catalogo', 'stock']; 
// Palabras críticas para escalamiento inmediato (Prioridad 0.0)
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 

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
            
            // --- CONSTANTES DE MENSAJES ---
            const mensajePago = 
                `*¡ANTICIPO O PAGO RÁPIDO!* 💰\n` +
                `Si deseas asegurar tu pedido o hacer un anticipo, puedes usar nuestros datos de Scotiabank:\n\n` +
                `*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez\n` + 
                `*🏦 BANCO:* Scotiabank\n` +
                `*CLABE:* **044320256058512878**\n` +
                `*Tarjeta:* **5579209154257585**\n\n` +
                `_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;
            const mensajeDinamicaVideo = 
                `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;
            const mensajeSaludoExistente = `¡Hola, bienvenida de nuevo! 😊 ¿En qué puedo ayudarte hoy? Recuerda que nuestra dinámica de compra está en este video: ${VIDEO_BIENVENIDA_URL}`;
            
            
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
                
                conversacionEnEscalamiento.set(numero, true);
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR PEDIDO CLARO / IMAGEN 🚩
            // -------------------------------------------
            const buscaPedidoClaro = textoSinTildes.includes('quiero hacer un pedido') ||
                                     textoSinTildes.includes('hacer un pedido') ||
                                     textoSinTildes.includes('quiero comprar') ||
                                     textoSinTildes.includes('para comprar') ||
                                     textoSinTildes.includes('compraria') ||
                                     textoSinTildes.includes('dame el precio') ||
                                     textoSinTildes.includes('pedido') ||
                                     textoSinTildes.includes('orden') ||
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('envio') || // <--- CORRECCIÓN 1: Agregar ENVÍO
                                     textoSinTildes.includes('cuanto');  // <--- CORRECCIÓN 1: Agregar CUANTO (Costo/Precio)

            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar'))
            );

            if (esImagenDePedido || buscaPedidoClaro) {
                console.log(`🚨 ESCALANDO a humano por intencion de PEDIDO/COMPRA/ENVÍO de ${numero}.`);
                await notificarSlack(numero, `INTENCIÓN DE COMPRA CLARA/IMAGEN/ENVÍO: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                const respuestaEscala = `¡Excelente! 🛒 Con gusto te ayudo a finalizar tu compra. Estoy conectando tu conversación con una vendedora experta para confirmar stock, tallas y resolver cualquier duda. Te atenderán en breve. ¡Gracias! 😊\n\n${mensajePago}`;
                await enviarTextoWasender(numero, respuestaEscala);
                
                conversacionEnEscalamiento.set(numero, true);
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (MENSAJE CORTO) 🚩
            // -------------------------------------------
            
            const esSaludoSimple = textoSinTildes.includes('hola') || 
                                   textoSinTildes.includes('hi') ||
                                   textoSinTildes.includes('buenos dias') ||
                                   textoSinTildes.includes('buenas tardes') ||
                                   textoSinTildes.includes('buenas') ||
                                   textoSinTildes.length < 10; 
            
            if (esSaludoSimple && bienvenidaEnviada.has(numero) && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Saludo simple de número EXISTENTE. Enviando saludo recurrente y video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                await enviarTextoWasender(numero, mensajeSaludoExistente);
                
                continue; 
            }

            // -------------------------------------------
            // 🚩 1.5 PRIORIDAD: DESCARTE POR CIERRE O AGRADECIMIENTO 🚩
            // -------------------------------------------
            // Esto evita que 'gracias' caiga en la Prioridad 2 (Video de dinámica).
            const buscaCierre = textoSinTildes.includes('gracias') ||
                                // Eliminamos 'sale' para evitar confusión con "¿en cuanto sale?"
                                textoSinTildes.includes('bye') ||
                                textoSinTildes.includes('saludos'); // <--- CORRECCIÓN 2: Eliminación de 'sale'

            if (buscaCierre && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Mensaje de cierre/agradecimiento detectado de ${numero}.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                const mensajeCierre = `¡Un gusto saludarte! Estamos aquí para lo que necesites. Que tengas un excelente día. 😊`;
                await enviarTextoWasender(numero, mensajeCierre);
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO (RESPUESTA RÁPIDA) 🚩
            // -------------------------------------------
            
            // LÓGICA DE PAGO
            const buscaPago = textoSinTildes.includes('pago') || textoSinTildes.includes('anticipo') || 
                              textoSinTildes.includes('scotiabank') || textoSinTildes.includes('transferencia') ||
                              textoSinTildes.includes('deposito') || textoSinTildes.includes('cuenta');
            
            // LÓGICA DE DINÁMICA/VIDEO 
            const buscaDinamica = textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('como se realiza') ||
                                   textoSinTildes.includes('realizo una compra') ||
                                   textoSinTildes.includes('como') || 
                                   textoSinTildes.includes('proceso') || 
                                   textoSinTildes.includes('realizo'); 
                  
            if (buscaPago || buscaDinamica) {
                console.log(`[FLOW] Solicitud de Pago/Dinamica de ${numero}.`);
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
            // 🚩 3. PRIORIDAD: LÓGICA DE BIENVENIDA COMPLETA (CLIENTE NUEVO) 🚩
            // -------------------------------------------
            
            if (!bienvenidaEnviada.has(numero)) { 
                console.log(`[FLOW] Cliente NUEVO. Enviando flujo de bienvenida COMPLETA.`);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // --- MENSAJE DE BIENVENIDA (PRIMER PARTE) ---
                const bienvenidaTextoParte1 = 
                    `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨\n\n` +
                    `¿Tienes tienda o te manejas sobre pedido?\n\n` +
                    `A continuación, te dejo nuestro link de nuestra página oficial: https://www.facebook.com/share/19928ADEfk/\n\n` + 
                    mensajeDinamicaVideo; 

                await enviarTextoWasender(numero, bienvenidaTextoParte1);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // --- MENSAJE DE OFERTA (SEGUNDA PARTE) ---
                const bienvenidaTextoParte2 = 
                    `¡Realiza tu **primera compra** y llévate un cupón! 🎁\n\n` +
                    `1.-Cupón: Realiza una compra mínima de *$4000 MXN* se brinda el precio de corrida que son 10 pesos menos por prenda del precio de mayoreo\n\n` +
                    `2.-Cupón: Realiza una compra mínima de *$6000 MXN* se brinda el precio de paquete que son 20 pesos menos por prenda del precio de mayoreo`;
                
                await enviarTextoWasender(numero, bienvenidaTextoParte2);
                
                // Registramos la bienvenida en la memoria persistente
                bienvenidaEnviada.set(numero, true);
                await guardarMemoria(); 
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
                    console.log(`🚨 ESCALANDO FORZADO: La IA falló, pero la pregunta (${texto}) contiene Keywords de producto.`);
                    escalarAHumano = true;
                }
            }
            
            if (escalarAHumano) {
                console.log(`🚨 ESCALANDO a humano por solicitud de producto/compra: ${numero}`);
                await notificarSlack(numero, texto);
                
                conversacionEnEscalamiento.set(numero, true);
                
                // --- MENSAJE DE ESCALAMIENTO FINAL ---
                let mensajeEscalaBase = `¡Claro! Permíteme un momento, estoy conectando tu conversación con una vendedora experta. En breve te atenderán personalmente para ayudarte con stock, tallas, y método de pago. ¡Gracias! 😊`;
                
                respuesta = mensajeEscalaBase;
                if (buscaPago) {
                    respuesta += '\n\n' + mensajePago;
                }

            } else {
                // 3. Si no escaló, enviar la respuesta de la IA.
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
