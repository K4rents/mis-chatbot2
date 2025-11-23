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
const conversacionEnEscalamiento = new Map(); // Mapa para controlar si el humano ya fue notificado (P0.2)
let videoDinamicaEnviada = new Map(); 

// Palabras clave de producto/compra 
const palabrasProducto = ['modelo', 'talla', 'precio', 'vestido', 'falda', 'blusa', 'pantalón', 'pantalon', 'ropa', 'artículo', 'articulo', 'catalogo', 'stock']; 
// Palabras críticas para escalamiento inmediato (Prioridad 0.0)
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 

// 🚨 Palabras de alerta/extorsión (seguridad)
const palabrasPeligro = [
    'extorsion', 'extorsión', 'amenaza', 'amenazando',
    'peligro', 'ayuda', 'auxilio', 'me quieren extorsionar',
    'policia', 'policía', 'cartel', 'cártel', 'delincuente',
    'intimidacion', 'intimidación', 'chantaje', 'secuestr'
];

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

// MENSAJE DE CIERRE PURO (P1.5)
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
        bienvenidaEnviada = new Map(parsed.bienvenidaEnviada || []);
        if (parsed.videoDinamicaEnviada) {
            videoDinamicaEnviada = new Map(parsed.videoDinamicaEnviada);
        }
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
            bienvenidaEnviada: Array.from(bienvenidaEnviada.entries()),
            videoDinamicaEnviada: Array.from(videoDinamicaEnviada.entries())
        });
        await fs.writeFile(MEMORY_FILE, data, 'utf8');
        console.log('💾 Memoria de bienvenida y dinámica guardada.');
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
        throw new Error("WASENDER_FAIL"); // Lanza un error para ser capturado por el flujo principal
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
    }
    if(!videoDinamicaEnviada.has(numero)) {
        videoDinamicaEnviada.set(numero, true);
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
            
            // ❌ NO RESPONDER EN GRUPOS
            const esGrupo = String(numeroRaw).endsWith('@g.us');
            if (esGrupo) {
                console.log(`❌ MENSAJE DE GRUPO DETECTADO Y BLOQUEADO: ${numeroRaw}`);
                continue; 
            }

            // Normalizar/extraer dígitos del JID (fix Telcel corrupto)
            const digits = String(numeroRaw).replace(/\D/g, ''); // solo dígitos
            let numero;
            if (digits.startsWith('521') && digits.length >= 12) {
                // Ya está en formato internacional para WA (521...)
                numero = digits;
                console.log(`✅ Número ya en formato WA detectado: ${numero}`);
            } else if (digits.startsWith('52') && digits.length >= 11) {
                // caso 52 + 10 dígitos
                numero = digits.startsWith('521') ? digits : ('521' + digits.slice(-10));
                console.log(`✅ Normalizado desde 52... -> ${numero}`);
            } else if (digits.length >= 10) {
                // Telcel corrupto o números largos: tomar últimos 10 dígitos y forzar 521+
                const last10 = digits.slice(-10);
                numero = '521' + last10;
                console.log(`✅ Telcel/ruido detectado. Extraído cliente real: ${last10} -> ${numero}`);
            } else {
                // No tenemos suficientes dígitos razonables: saltamos
                console.log(`⛔ JID inválido o demasiado corto después de limpiar: ${digits}`);
                continue;
            }
            
            const textoLower = texto.toLowerCase();
            const textoSinTildes = stripAccents(textoLower); 
            
            // --- Seguridad: detectar extorsión / peligro ---
            const esPeligro = palabrasPeligro.some(p => textoSinTildes.includes(p));
            if (esPeligro) {
                console.log(`🚨 ALERTA DE PELIGRO/EXTORSIÓN DETECTADO: ${numero}`);
                // Notificar a Slack con prioridad
                await notificarSlack(numero, `⚠️ POSIBLE EXTORSIÓN / PELIGRO: "${texto}"`);
                // Responder con mensaje de ayuda pero no continuar interacción
                try {
                    await enviarTextoWasender(numero, 
                        `⚠️ *Tu mensaje parece indicar una situación de riesgo.*\n\n` +
                        `Ya notifiqué a nuestro equipo para que te atienda personalmente. Si estás en riesgo real, por favor comunícate con las autoridades.`
                    );
                } catch (e) {
                    console.error('⚠️ Fallo al enviar mensaje de alerta de peligro:', e.message);
                }
                // Marcar en escalamiento para seguimiento y no procesar más
                conversacionEnEscalamiento.set(numero, Date.now());
                if (!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue;
            }
            
            // --- Definición de Filtros de Pregunta (P0 y P2)
            const esPreguntaInformacional = textoSinTildes.includes('como se') || 
                                            textoSinTildes.includes('como hago') || 
                                            textoSinTildes.includes('como realizo') || 
                                            textoSinTildes.includes('cual es la dinamica') ||
                                            textoSinTildes.includes('como funciona');
            
            const buscaPedidoClaro = textoSinTildes.includes('quiero hacer un pedido') || 
                                     textoSinTildes.includes('quiero realizar un pedido') || 
                                     textoSinTildes.includes('hacer un pedido') || 
                                     textoSinTildes.includes('realizar un pedido') || 
                                     textoSinTildes.includes('quiero comprar') ||
                                     textoSinTildes.includes('para comprar') ||
                                     textoSinTildes.includes('compraria') ||
                                     textoSinTildes.includes('dame el precio') ||
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('compra') || 
                                     textoSinTildes.includes('pedido') || 
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
            // --- Fin definición P0
            
            // --- FILTRO PARA REENVÍO DE PAGO EN P0.2
            const buscaReenvioPago = textoSinTildes.includes('pago') || 
                                     textoSinTildes.includes('pagar') || 
                                     textoSinTildes.includes('cuenta') || 
                                     textoSinTildes.includes('clabe') || 
                                     textoSinTildes.includes('transferencia') ||
                                     textoSinTildes.includes('deposito') ||
                                     textoSinTildes.includes('comprobante') || 
                                     textoSinTildes.includes('comprar') ||
                                     textoSinTildes.includes('pedido') ||
                                     textoSinTildes.includes('datos');
            // --- FIN FILTRO
            
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
            // --- FIN FILTRO
            
            // --- FILTROS PARA ESCALAMIENTO SUAVE (P0.5 y P0.6)
            const buscaEnvio = textoSinTildes.includes('envio') || textoSinTildes.includes('estafeta') || textoSinTildes.includes('paqueteria');
            const buscaProductoGenerico = palabrasProducto.some(keyword => textoSinTildes.includes(keyword));
            // --- FIN FILTROS

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
            // --- FIN FILTROS
            
            // -------------------------------------------
            // 🚩 0.2 PRIORIDAD: BLOQUEO DE RESPUESTA REPETITIVA POST-ESCALAMIENTO (Reenvío de Pago) 🚩
            // -------------------------------------------
            if (conversacionEnEscalamiento.has(numero)) {
                
                // V15: BYPASS CONDITIONS (Cierre, Producto, Envío, INFO GENÉRICA, SALUDO, DINÁMICA)
                if (buscaCierre || buscaEnvio || buscaProductoGenerico || (buscaInformesGenerico && !esEspecifico) || esSaludoSimple || esPreguntaInformacional) {
                    console.log(`⭐ BYPASS P0.2: Cierre/Producto/Envio/Info/Saludo/Dinamica detectado. Cayendo a su prioridad específica.`);
                    // Permitimos que el flujo continúe sin "continue" para que P0.5/P0.6/P1/P1.1/P1.5/P2 se ejecuten.
                } else {
                    // Lógica de BLOQUEO para mensajes repetitivos de venta/info AGRESIVA
                    console.log(`🔒 BLOQUEO DE RESPUESTA: Cliente ${numero} ya en escalamiento.`);
                    
                    // Action 1: Re-notificar Slack en mensajes agresivos repetidos.
                    await notificarSlack(numero, `REPETICIÓN DE INTENTO DE COMPRA/CONTACTO: "${texto}"`);
                    
                    // Action 2: Check if the user is looking for payment data.
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
                        // No response to avoid annoyance.
                    }
                    
                    continue; // Detiene el flujo aquí si no es una palabra de bypass
                }
            }
            
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
                
                try {
                    await enviarTextoWasender(numero, respuestaCritica);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P0.0 Crítico, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0. PRIORIDAD MÁXIMA: ESCALAMIENTO POR PEDIDO CLARO / CONTACTO / IMAGEN (VENTA AGRESIVA) 🚩
            // -------------------------------------------
            
            const esImagenDePedido = (
                msgObj.message?.imageMessage && 
                (textoSinTildes.includes('pedido') || textoSinTildes.includes('orden') || textoSinTildes.includes('comprar') || textoSinTildes.includes('pago')) 
            );

            // Importante: No se dispara si es pregunta INFORMACIONAL (se cae a P2)
            if ((esImagenDePedido || buscaPedidoClaro) && !esPreguntaInformacional) {
                console.log(`🚨 ESCALANDO a humano por intencion de COMPRA/CONTACTO/SEGMENTACIÓN CLARA (P0) de ${numero}.`);
                await notificarSlack(numero, `INTENCIÓN DE COMPRA/CONTACTO/SEGMENTACIÓN: "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeEscalaCompleta);
                } catch (e) {
                     console.error('⚠️ Fallo en enviar mensaje P0 Completo, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 0.5 PRIORIDAD: ESCALAMIENTO SUAVE POR ENVÍO (SIN DINERO) 🚩
            // -------------------------------------------
            
            if (buscaEnvio) {
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de ENVÍO/LOGÍSTICA: ${numero}.`);
                
                await notificarSlack(numero, `PREGUNTA SOBRE ENVÍO/LOGÍSTICA: "${texto}"`);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeEnvioEscalaSuave);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P0.5 Envío, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }

            // -------------------------------------------
            // 🚩 0.6 PRIORIDAD: ESCALAMIENTO SUAVE POR PRODUCTO/TALLA (SIN DINERO) 🚩
            // -------------------------------------------
            
            if (buscaProductoGenerico) {
                console.log(`🚨 ESCALANDO SUAVE a humano por solicitud de PRODUCTO/TALLA/PRECIO (P0.6): ${numero}.`);
                
                await notificarSlack(numero, `PREGUNTA SOBRE PRODUCTO/TALLA/PRECIO: "${texto}"`);
                
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeProductoEscalaSuave);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P0.6 Producto, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 2. PRIORIDAD: MECÁNICA DE COMPRA / PAGO / DINÁMICA (RESPUESTA RÁPIDA - VIDEO/DATOS) 🚩
            // -------------------------------------------
            
            const buscaPagoDatos = textoSinTildes.includes('scotiabank') || 
                              textoSinTildes.includes('transferencia') ||
                              textoSinTildes.includes('transfiero') || 
                              textoSinTildes.includes('transferir') || 
                              textoSinTildes.includes('deposito') || 
                              textoSinTildes.includes('cuenta');
            
            const buscaDinamica = esPreguntaInformacional ||
                                   textoSinTildes.includes('mecanica') || 
                                   textoSinTildes.includes('dinamica') || 
                                   textoSinTildes.includes('proceso');
            
            if (buscaPagoDatos || buscaDinamica) { 
                console.log(`[FLOW] Solicitud de Pago/Dinamica/Instrucciones (P2) de ${numero}.`);
                
                // 1. Send Payment Data (if requested)
                if (buscaPagoDatos) {
                    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                    try {
                        await enviarTextoWasender(numero, mensajePago);
                    } catch (e) {
                         console.error('⚠️ Fallo en enviar mensaje P2 Pago, se continúa el flujo:', e.message);
                    }
                }
                
                // 2. Send Dynamic Video (ALWAYS send if requested)
                if (buscaDinamica) { 
                    await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                    try {
                        await enviarTextoWasender(numero, mensajeDinamicaVideo);
                    } catch (e) {
                         console.error('⚠️ Fallo en enviar mensaje P2 Dinámica, se continúa el flujo:', e.message);
                    }
                    videoDinamicaEnviada.set(numero, true); // Mark state for memory/other flows
                }
                
                // Update welcome state
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                }
                await guardarMemoria();

                // Continuamos para bloquear la IA.
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.5 PRIORIDAD: DESCARTE POR CIERRE O AGRADECIMIENTO 🚩
            // -------------------------------------------
            
            if (buscaCierre) { 
                console.log(`[FLOW] Mensaje de cierre/agradecimiento/acuse de recibo detectado de ${numero}. Enviando cierre simple.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeCierrePuro);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P1.5 Cierre, se continúa el flujo:', e.message);
                }
                
                continue; 
            }
            
            // -------------------------------------------
            // 1. PRIORIDAD: SALUDO SIMPLE DE CLIENTE EXISTENTE (MENSAJE CORTO) 
            // -------------------------------------------
            
            if (esSaludoSimple && bienvenidaEnviada.has(numero) && !conversacionEnEscalamiento.has(numero)) {
                console.log(`[FLOW] Saludo simple de número EXISTENTE. Enviando saludo recurrente y video.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeSaludoExistente);
                } catch (e) {
                     console.error('⚠️ Fallo en enviar mensaje P1 Saludo, se continúa el flujo:', e.message);
                }
                
                continue; 
            } else if (esSaludoSimple && bienvenidaEnviada.has(numero) && conversacionEnEscalamiento.has(numero)) {
                // Caso de Bypass P0.2: Saludo simple en estado de escalamiento.
                console.log(`[FLOW] Saludo simple de número EXISTENTE en estado de escalamiento (P0.2 Bypass). Enviando saludo recurrente.`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeSaludoExistente);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P1 Saludo con Escal, se continúa el flujo:', e.message);
                }
                
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 1.1 PRIORIDAD: INFORMES (BIFURCACIÓN GENÉRICO vs. ESPECÍFICO) 🚩
            // -------------------------------------------

            if (buscaInformesGenerico && esEspecifico) {
                // SCENARIO A: INFORMACIÓN ESPECÍFICA (Escalada suave de producto)
                console.log(`🚨 ESCALANDO (P1.1 ESPECÍFICO) a humano por solicitud de INFORMES ESPECÍFICOS: ${numero}.`);
                await notificarSlack(numero, `PIDE INFORMES ESPECÍFICOS (Producto/Pedido): "${texto}"`);
                await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES));
                
                try {
                    await enviarTextoWasender(numero, mensajeProductoEscalaSuave);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P1.1 Específico, se continúa el flujo:', e.message);
                }
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, true);
                    await guardarMemoria();
                }
                continue; 
                
            } else if (buscaInformesGenerico) {
                // SCENARIO B: INFORMACIÓN GENÉRICA (Forzar Bienvenida Completa)
                console.log(`[FLOW] Solicitud de INFORMES/INFORMACION GENÉRICA detectada de ${numero}. Enviando Bienvenida Completa.`);
                
                // La bienvenida completa ya contiene control de errores interno en sus llamadas a Wasender
                await enviarBienvenidaCompleta(numero); 
                
                continue; 
            }

            
            // -------------------------------------------
            // 🚩 3. PRIORIDAD: LÓGICA DE BIENVENIDA COMPLETA (CLIENTE NUEVO - DEFAULT) 🚩
            // -------------------------------------------
            
            if (!bienvenidaEnviada.has(numero)) { 
                console.log(`[FLOW] Cliente NUEVO (DEFAULT). Enviando flujo de bienvenida COMPLETA.`);
                
                // La bienvenida completa ya contiene control de errores interno en sus llamadas a Wasender
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
                
                conversacionEnEscalamiento.set(numero, Date.now()); // Establece el estado de escalamiento
                
            } else {
                respuesta = respuestaIA;
            }
            
            if (respuesta) {
                 await new Promise(resolve => setTimeout(resolve, PAUSA_ENTRE_MENSAJES)); 
                try {
                    await enviarTextoWasender(numero, respuesta);
                } catch (e) {
                    console.error('⚠️ Fallo en enviar mensaje P4 IA/Escalada, se continúa el flujo:', e.message);
                }
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









ChatGPT puede cometer errores. C
