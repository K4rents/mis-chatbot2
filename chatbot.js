import express from "express";
import axios from "axios";
import fs from "fs/promises"; // ⬅️ V32: Importado para memoria persistente

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
// const URL_MECANICA_COMPRA = 'https://drive.google.com/file/d/163YfomYIO9JojMvQGy7VUa0EkV1tXKLe/view?usp=sharing'; // URL de dinámica no usada en la estructura final

const PAUSA_ENTRE_MENSAJES = 6000; // 6 segundos

// ⬅️ V32: MEMORIA PERSISTENTE Y ESTADOS
const MEMORY_FILE = 'welcome_memory.json'; 
const mensajesProcesados = new Set(); // Para evitar bucles en el mismo webhook
let bienvenidaEnviada = new Map(); // Mapa para estado de bienvenida persistente
const conversacionEnEscalamiento = new Map(); // Mapa para controlar si el humano ya fue notificado (P0.2)
let videoDinamicaEnviada = new Map(); 

// ⬅️ V32: PALABRAS CLAVE CENTRALIZADAS
const palabrasProducto = ['modelo', 'talla', 'precio', 'vestido', 'falda', 'blusa', 'pantalón', 'pantalon', 'ropa', 'artículo', 'articulo', 'catalogo', 'catalgo', 'stock']; 
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 
const respuestaCorta = ['sí', 'si', 'ok', 'claro', 'chica', 'chico', 's', 'okey', 'vale', 'va'];


// --- CONSTANTES DE MENSAJES (OPTIMIZADAS) ---
const mensajePago = 
    `*¡ANTICIPO O PAGO RÁPIDO!* 💰\n` +
    `Si deseas asegurar tu pedido o hacer un anticipo, puedes usar nuestros datos de Scotiabank:\n\n` +
    `*👤 BENEFICIARIO:* José de Jesús Conchas Rodriguez\n` + 
    `*🏦 BANCO:* Scotiabank\n` +
    `*CLABE:* **044320256058512878**\n` +
    `*Tarjeta:* **5579209154257585**\n\n` +
    `_Recuerda enviar tu comprobante al chat para que tu pedido avance._`;
    
const mensajeEscalaCompleta = 
    `¡Excelente! 🛒 Ya te estoy enlazando con nuestra *vendedora experta* para finalizar tu compra. Ella confirmará *stock*, *tallas* y resolverá cualquier duda. ¡Te atenderán de inmediato! 😊\n\n${mensajePago}`;

const mensajeEnvioEscalaSuave = 
    `¡Excelente! 📦 Ya te estoy enlazando con nuestra *vendedora experta*. Ella cotizará el *envío* y confirmará la cobertura. ¡Te atenderán de inmediato! 😊`;

const mensajeProductoEscalaSuave = 
    `¡Excelente! 👕 Ya te estoy enlazando con nuestra *vendedora experta*. Ella confirmará el *stock* y *talla* o resolverá cualquier otra duda que tengas. ¡Te atenderán de inmediato! 😊`;

const mensajeUbicacionEscalaSuave = 
    `*¡Sí!* 📍 Manejamos nuestra operación desde Guadalajara. Ya te estoy enlazando con nuestra *vendedora experta* para que te dé la *dirección exacta* de la bodega o te agende tu recolección. ¡Te atenderán de inmediato! 😊`;
    
const mensajeDinamicaVideo = 
    `Seguimos en línea para lo que necesites. 😊\n\n` +
    `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;

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

// ⬅️ V32: Funciones para cargar y guardar el estado de la conversación (memoria)
async function cargarMemoria() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        bienvenidaEnviada = new Map(parsed.bienvenidaEnviada || []);
        conversacionEnEscalamiento = new Map(parsed.conversacionEnEscalamiento || []);
        videoDinamicaEnviada = new Map(parsed.videoDinamicaEnviada || []);
        console.log(`✅ Memoria de bienvenida y escalamiento cargada. ${bienvenidaEnviada.size} clientes recurrentes.`);
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
            bienvenidaEnviada: Array.from(bienvenidaEnviada.entries()),
            conversacionEnEscalamiento: Array.from(conversacionEnEscalamiento.entries()),
            videoDinamicaEnviada: Array.from(videoDinamicaEnviada.entries()) 
        });
        await fs.writeFile(MEMORY_FILE, data, 'utf8');
        // console.log('💾 Memoria de bienvenida y dinámica guardada.'); // Se comenta para evitar spam
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
        const response = await axios.post(WASENDER_API, {
            to: numero, 
            text: text
        }, {
            headers: { 'Authorization': `Bearer ${WASENDER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        // Si el servidor de Wasender devuelve un error HTTP 200 pero con success: false, lanzamos error.
        if (response.data && response.data.success === false) {
             console.error('❌ Error al enviar mensaje de texto (API):', response.data);
             throw new Error("WASENDER_FAIL");
        }
        console.log(`💬 Mensaje de texto enviado a ${numero}. Respuesta: ${text.substring(0, 50)}...`);
    } catch (error) {
        // Captura errores de red o el error "WASENDER_FAIL" lanzado arriba
        console.error('❌ Error al enviar mensaje de texto:', error.response?.data || error.message);
        throw new Error("WASENDER_FAIL"); 
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
        `_Haga clic aquí para abrir el chat en WhatsApp: ${WA_LINK}_`;

    const slackPayload = {
        text: alertaTextoSinFormato,
        username: 'Boutique Bot Alerta',
        icon_emoji: ':robot_face:',
    };
    
    try {
        await axios.post(SLACK_WEBHOOK_URL, slackPayload);
        console.log('✅ Alerta de escalamiento enviada a Slack con enlace wa.me.');
    } catch (error) {
        console.error('❌ Error al notificar Slack:', error.message);
        throw new Error("SLACK_FAIL"); 
    }
}

async function enviarBienvenidaCompleta(numero) {
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    try {
        await enviarTextoWasender(numero, bienvenidaTextoParte1);
    } catch (e) {
        console.error('⚠️ Fallo en enviar Bienvenida Parte 1:', e.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
    
    try {
        await enviarTextoWasender(numero, bienvenidaTextoParte2);
    } catch (e) {
         console.error('⚠️ Fallo en enviar Bienvenida Parte 2:', e.message);
    }
    
    if(!bienvenidaEnviada.has(numero)) {
        bienvenidaEnviada.set(numero, Date.now());
    }
    if(!videoDinamicaEnviada.has(numero)) {
        videoDinamicaEnviada.set(numero, Date.now());
    }
    await guardarMemoria();
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
            
            // ⬅️ V32: Normalización de números mexicanos a formato E.164 (521...)
            if (numero.length === 10 && !numero.startsWith('52')) {
                numero = '521' + numero;
                console.log(`✅ Número normalizado: Forzado a 521 + 10 dígitos -> ${numero}`);
            } else if (numero.length === 12 && numero.startsWith('521')) {
                console.log(`✅ Número ya normalizado: ${numero}`);
            }

            // ⬅️ V32: Bloqueo de JID/números excesivamente largos (defensa contra error externo)
            if (numero.length > 13) {
                console.log(`❌ MENSAJE DE NUMERO EXCESIVAMENTE LARGO DETECTADO Y BLOQUEADO: ${numero}. JID INESPERADO.`);
                continue; 
            }
            // -------------------------------------------
            
            const textoLower = texto.toLowerCase();
            const textoSinTildes = stripAccents(textoLower); 
            
            // --- Definición de Filtros de Pregunta (P0 y P2) ---
            const esPreguntaInformacional = textoSinTildes.includes('como se') || 
                                            textoSinTildes.includes('como hago') || 
                                            textoSinTildes.includes('como realizo') || 
                                            textoSinTildes.includes('cual es la dinamica') ||
                                            textoSinTildes.includes('como funciona');
            
            // FILTRO P0: Intención de compra/pedido CLARA
            const buscaPedidoClaro = textoSinTildes.includes('quiero hacer un pedido') || 
                                     textoSinTildes.includes('quiero realizar un pedido') || 
                                     textoSinTildes.includes('quiero realizar una compra') || 
                                     textoSinTildes.includes('voy a realizar una compra') || 
                                     textoSinTildes.includes('hacer un pedido') || 
                                     textoSinTildes.includes('realizar un pedido') || 
                                     textoSinTildes.includes('quiero comprar') ||
                                     textoSinTildes.includes('quiero compra') || 
                                     textoSinTildes.includes('para comprar') ||
                                     textoSinTildes.includes('compraria') ||
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('compra') || 
                                     textoSinTildes.includes('pedido') || 
                                     textoSinTildes.includes('cuanto') ||
                                     textoSinTildes.includes('pago') || 
                                     textoSinTildes.includes('pagar') || 
                                     textoSinTildes.includes('contactar a la persona') || 
                                     textoSinTildes.includes('quiero hablar con') ||     
                                     textoSinTildes.includes('asesor') ||
                                     textoSinTildes.includes('tienda') || 
                                     textoSinTildes.includes('sobre pedido') ||
                                     textoSinTildes.includes('comprobante') || 
                                     textoSinTildes.includes('captura'); 
            
            // --- FILTRO PARA REENVÍO DE PAGO EN P0.2 
            const buscaReenvioPago = textoSinTildes.includes('pago') || 
                                     textoSinTildes.includes('pagar') || 
                                     textoSinTildes.includes('cuenta') || 
                                     textoSinTildes.includes('clabe') || 
                                     textoSinTildes.includes('transferencia') ||
                                     textoSinTildes.includes('transfiero') || 
                                     textoSinTildes.includes('deposito') ||
                                     textoSinTildes.includes('comprobante') || 
                                     textoSinTildes.includes('datos') ||
                                     textoSinTildes.includes('cinta'); 
            
            // --- FILTRO PARA CIERRE (P1.5)
            const buscaCierre = textoSinTildes.includes('gracias') ||
                                textoSinTildes.includes('bye') ||
                                textoSinTildes.includes('saludos') ||
                                textoSinTildes.includes('ok') || 
                                textoSinTildes.includes('va') || 
                                textoSinTildes.includes('vale') || 
                                textoSinTildes.includes('sale') || 
                                textoSinTildes.includes('está bien') || 
                                textoSinTildes.includes('esta bien'); 
            
            // --- FILTROS PARA ESCALAMIENTO SUAVE (P0.5, P0.6, P0.9)
            const buscaEnvio = textoSinTildes.includes('envio') || textoSinTildes.includes('estafeta') || textoSinTildes.includes('paqueteria');
            const buscaProductoGenerico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));
            const buscaSi = textoSinTildes === 'si';
            const buscaUbicacion = textoSinTildes.includes('donde') || 
                                   textoSinTildes.includes('bodega') || 
                                   textoSinTildes.includes('recoger') || 
                                   textoSinTildes.includes('direccion') || 
                                   textoSinTildes.includes('ubicacion') || 
                                   textoSinTildes.includes('guadalajara'); 
            const buscaCatalogoEspecifico = textoSinTildes.includes('catalogo') || 
                                            textoSinTildes.includes('catalgo') || 
                                            textoSinTildes.includes('catalagó') || 
                                            textoSinTildes.includes('lista') || 
                                            textoSinTildes.includes('catalog'); 
            
            // --- FILTROS PARA INFORMES (P1.1) Y SALUDO (P1)
            const buscaInformesGenerico = textoSinTildes.includes('informes') || 
                                          textoSinTildes.includes('informacion') ||
                                          textoSinTildes.includes('info') || 
                                          textoSinTildes.includes('tienes informacion');
            const esEspecifico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));
            const esSaludoSimple = textoSinTildes.includes('hola') || 
                                   textoSinTildes.includes('hi') ||
                                   textoSinTildes.includes('buenos dias') ||
                                   textoSinTildes.includes('buenas tardes') ||
                                   textoSinTildes.includes('buenas');
            
            
            // -------------------------------------------
            // 🚩 0.0 PRIORIDAD MÁXIMA: DEVOLUCIONES / CAMBIOS (CRÍTICO) -------------------------------------------
            // -------------------------------------------
            const esTemaCritico = palabrasCriticas.some(keyword => textoSinTildes.includes(keyword));

            if (esTemaCritico) {
                console.log(`🚨 ESCALANDO CRÍTICO a humano por TEMA SENSIBLE/DEVOLUCIÓN: ${numero}`);
                
                try {
                    await notificarSlack(numero, `TEMA CRÍTICO (Devolución/Cambio): "${texto}"`);
                } catch (e) {
                    console.error('⚠️ Fallo en notificar Slack P0.0 Crítico:', e.message);
                }
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                const respuestaCritica = 
                    `¡Lamento el inconveniente! 😔 Este es un tema sensible que debe ser manejado por un humano. \n\n` + 
                    `Ya hemos notificado a nuestro equipo de *Atención al Cliente* sobre tu *devolución/cambio*. \n` + 
                    `En breve una persona te atenderá para *recabar los datos necesarios* y ayudarte con el proceso.`;
                
                try {
                    await enviarTextoWasender(numero, respuestaCritica);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P0.0 Crítico, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, Date.now());
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR PEDIDO CLARO / IMAGEN 🚩
            // -------------------------------------------
            
            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar') || textoSinTildes.includes('pago')) 
            );

            if ((esImagenDePedido || buscaPedidoClaro) && !esPreguntaInformacional) {
                console.log(`🚨 ESCALANDO a humano por intencion de COMPRA/CONTACTO/SEGMENTACIÓN CLARA (P0) de ${numero}.`);
                
                try {
                    await notificarSlack(numero, `INTENCIÓN DE COMPRA/CONTACTO/SEGMENTACIÓN: "${texto}"`);
                } catch (e) {
                    console.error('⚠️ Fallo en notificar Slack P0 Compra:', e.message);
                }
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                // V27/V28: ¡SOLO SE ENVÍA EL MENSAJE COMPLETO UNA VEZ!
                try {
                    await enviarTextoWasender(numero, mensajeEscalaCompleta);
                } catch (e) {
                     console.error('⚠️ Fallo en enviar mensaje P0 Completo (Mensaje Largo):', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, Date.now());
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0.2 PRIORIDAD: BLOQUEO DE RESPUESTA REPETITIVA POST-ESCALAMIENTO 🚩
            // -------------------------------------------
            if (conversacionEnEscalamiento.has(numero)) {
                
                // BYPASS CONDITIONS (permite que los flujos P0.5 a P1.5 se ejecuten)
                if (buscaCierre || buscaEnvio || buscaProductoGenerico || buscaUbicacion || buscaCatalogoEspecifico || (buscaInformesGenerico && !esEspecifico) || esSaludoSimple || esPreguntaInformacional) { 
                    console.log(`⭐ BYPASS P0.2: Catálogo/Cierre/Producto/Envio/Ubicacion/Info/Saludo/Dinamica detectado. Cayendo a su prioridad específica.`);
                    // Continúa la ejecución normal.
                } else {
                    // Lógica de BLOQUEO para mensajes repetitivos de venta/info AGRESIVA
                    console.log(`🔒 BLOQUEO DE RESPUESTA: Cliente ${numero} ya en escalamiento.`);
                    
                    // Action 1: Re-notificar Slack en mensajes agresivos repetidos.
                    try {
                         await notificarSlack(numero, `REPETICIÓN DE INTENTO DE COMPRA/CONTACTO: "${texto}"`);
                    } catch (e) {
                        console.error('⚠️ Fallo en notificar Slack P0.2 Repetición:', e.message);
                    }
                    
                    // Action 2: Check if the user is looking for payment data (Bypass).
                    if (buscaReenvioPago) { 
                        console.log("💳 Sobreescribiendo bloqueo: Re-enviando solo datos de pago (mensajePago).");
                        await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                        
                        try {
                            await enviarTextoWasender(numero, mensajePago);
                        } catch (e) {
                             console.error('⚠️ Fallo en enviar mensaje P0.2 Pago, se continúa el flujo:', e.message);
                        }
                    } else {
                        console.log("🤫 Silenciando bot para intervención humana (mensaje no relacionado a pago).");
                    }
                    
                    continue; // Detiene el flujo aquí si no es una palabra de bypass
                }
            }
            
            
            // -------------------------------------------
            // 🚩 0.5 - 0.9 PRIORIDADES: ESCALAMIENTOS SUAVES 🚩
            // -------------------------------------------
            
            if (buscaEnvio) { // P0.5: ENVÍO
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de ENVÍO/LOGÍSTICA (P0.5): ${numero}.`);
                try { await notificarSlack(numero, `PREGUNTA SOBRE ENVÍO/LOGÍSTICA: "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeEnvioEscalaSuave); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
            }

            if (buscaProductoGenerico) { // P0.6: PRODUCTO/TALLA
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de PRODUCTO/TALLA/PRECIO (P0.6): ${numero}.`);
                try { await notificarSlack(numero, `PREGUNTA SOBRE PRODUCTO/TALLA/PRECIO: "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeProductoEscalaSuave); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
            }
            
            if (buscaSi) { // P0.7: RESPUESTA 'SI'
                console.log(`🚨 ESCALANDO SUAVE a humano por respuesta 'SI' (P0.7): ${numero}.`);
                try { await notificarSlack(numero, `RESPUESTA 'SI' a pregunta de IA (Soft Escalation): "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeProductoEscalaSuave); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
            }
            
            if (buscaCatalogoEspecifico && !esPreguntaInformacional) { // P0.8: CATÁLOGO (FORZADO A P0)
                console.log(`🚨 ESCALANDO MÁXIMO (FORZADO P0) a humano por solicitud de CATÁLOGO: ${numero}.`);
                try { await notificarSlack(numero, `PREGUNTA SOBRE CATÁLOGO (FORZADA A P0): "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeEscalaCompleta); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
            }
            
            if (buscaUbicacion) { // P0.9: UBICACIÓN/RECOLECCIÓN
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de UBICACIÓN/RECOLECCIÓN (P0.9): ${numero}.`);
                try { await notificarSlack(numero, `PREGUNTA SOBRE UBICACIÓN/RECOLECCIÓN/TIENDA: "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeUbicacionEscalaSuave); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO / DINÁMICA (RESPUESTA RÁPIDA) 🚩
            // -------------------------------------------
            
            const buscaPagoDatos = textoSinTildes.includes('scotiabank') || 
                              textoSinTildes.includes('transferencia') ||
                              textoSinTildes.includes('clabe') ||
                              textoSinTildes.includes('cinta'); 
            
            const buscaDinamica = esPreguntaInformacional ||
                                   textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('proceso');
            
            if (buscaPagoDatos || buscaDinamica) { 
                console.log(`[FLOW] Solicitud de Pago/Dinamica/Instrucciones (P2) de ${numero}.`);
                
                if (buscaPagoDatos) {
                    console.log("💳 Enviando datos de pago...");
                    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                    try { await enviarTextoWasender(numero, mensajePago); } catch (e) { console.error('⚠️ Fallo en enviar mensaje P2 Pago:', e.message); }
                }
                
                if (buscaDinamica) { 
                    console.log("🎥 Enviando mensaje de video/dinámica...");
                    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                    try { await enviarTextoWasender(numero, mensajeDinamicaVideo); } catch (e) { console.error('⚠️ Fallo en enviar mensaje P2 Dinámica:', e.message); }
                    videoDinamicaEnviada.set(numero, Date.now()); 
                }
                
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); }
                await guardarMemoria();

                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.5 PRIORIDAD: DESCARTE POR CIERRE O AGRADECIMIENTO 🚩
            // -------------------------------------------
            
            if (buscaCierre) { 
                console.log(`[FLOW] Mensaje de cierre/agradecimiento/acuse de recibo detectado de ${numero}. Enviando cierre simple.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try { await enviarTextoWasender(numero, mensajeCierrePuro); } catch (e) { console.error('⚠️ Fallo en enviar mensaje P1.5 Cierre, se continúa el flujo:', e.message); }
                
                continue; 
            }
            
            // -------------------------------------------
            // 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (MENSAJE CORTO) 
            // -------------------------------------------
            
            if (esSaludoSimple && bienvenidaEnviada.has(numero) && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Saludo simple de número EXISTENTE. Enviando saludo recurrente y video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try { await enviarTextoWasender(numero, mensajeSaludoExistente); } catch (e) { console.error('⚠️ Fallo en enviar mensaje P1 Saludo, se continúa el flujo:', e.message); }
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.1 PRIORIDAD: INFORMES (BIFURCACIÓN GENÉRICO vs. ESPECÍFICO) 🚩
            // -------------------------------------------

            if (buscaInformesGenerico && esEspecifico) {
                // SCENARIO A: INFORMACIÓN ESPECÍFICA (Escalada suave de producto)
                console.log(`🚨 ESCALANDO (P1.1 ESPECÍFICO) a humano por solicitud de INFORMES ESPECÍFICOS: ${numero}.`);
                try { await notificarSlack(numero, `PIDE INFORMES ESPECÍFICOS (Producto/Pedido): "${texto}"`); } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                try { await enviarTextoWasender(numero, mensajeProductoEscalaSuave); } catch (e) {}
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) { bienvenidaEnviada.set(numero, Date.now()); await guardarMemoria(); }
                continue; 
                
            } else if (buscaInformesGenerico) {
                // SCENARIO B: INFORMACIÓN GENÉRICA (Forzar Bienvenida Completa)
                console.log(`[FLOW] Solicitud de INFORMES/INFORMACION GENÉRICA detectada de ${numero}. Enviando Bienvenida Completa.`);
                await enviarBienvenidaCompleta(numero); 
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
                
                try { await notificarSlack(numero, texto); } catch (e) {}
                
                respuesta = mensajeProductoEscalaSuave; 
                
                conversacionEnEscalamiento.set(numero, Date.now()); 
                
            } else {
                respuesta = respuestaIA;
            }
            
            if (respuesta) {
                 await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES)); 
                try { await enviarTextoWasender(numero, respuesta); } catch (e) { console.error('⚠️ Fallo en enviar mensaje P4 IA/Escalada, se continúa el flujo:', e.message); }
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
    await cargarMemoria(); // ⬅️ V32: Carga la memoria al inicio
    console.log(`🤖 Chatbot activo en puerto ${PORT}.`);
});
