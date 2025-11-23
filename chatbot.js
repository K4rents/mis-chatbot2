import express from "express";
import axios from "axios";
import fs from "fs/promises"; // ⬅️ V33: Importado para memoria persistente

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
const VIDEO_BIENVENIDA_URL = 'https://drive.google.com/file/d/1W90iI4nJy7pqvraA--FJTT_HQQw3h4uJ/view'; 
const URL_MECANICA_COMPRA = 'https://drive.google.com/file/d/163YfomYIO9JojMvQGy7VUa0EkV1tXKLe/view?usp=sharing'; 

const PAUSA_ENTRE_MENSAJES = 6000; // 6 segundos

// ⬅️ V33: MEMORIA PERSISTENTE Y ESTADOS
const MEMORY_FILE = 'welcome_memory.json'; 
const mensajesProcesados = new Set(); // Para evitar bucles en el mismo webhook
let bienvenidaEnviada = new Map(); // Mapa PERSISTENTE (Reemplaza mensajesProcesados.has(bienvenidaKey))
const conversacionEnEscalamiento = new Map(); // Mapa PERSISTENTE para controlar P0.2 (Bloqueo)

// ⬅️ V33: PALABRAS CLAVE CRÍTICAS
const palabrasCriticas = ['devolución', 'devolucion', 'regresar', 'cambio', 'reembolso', 'reembolsar', 'queja', 'garantía', 'garantia']; 
const respuestaCorta = ['sí', 'si', 'ok', 'claro', 'chica', 'chico', 's', 'okey', 'vale', 'va'];


// ----------------------------------------------------
// 2. SERVICIOS EXTERNOS Y UTILIDADES
// ----------------------------------------------------

/**
 * V33: Funciones para cargar y guardar el estado de la conversación (memoria)
 */
async function cargarMemoria() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        bienvenidaEnviada = new Map(parsed.bienvenidaEnviada || []);
        conversacionEnEscalamiento = new Map(parsed.conversacionEnEscalamiento || []);
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
            conversacionEnEscalamiento: Array.from(conversacionEnEscalamiento.entries())
        });
        await fs.writeFile(MEMORY_FILE, data, 'utf8');
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
        // V33: Comprobación de éxito para manejo de errores robusto
        if (response.data && response.data.success === false) {
             console.error('❌ Error al enviar mensaje de texto (API):', response.data);
             throw new Error("WASENDER_FAIL");
        }
        console.log(`💬 Mensaje de texto enviado a ${numero}. Respuesta: ${text.substring(0, 50)}...`);
    } catch (error) {
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
        `_Haga clic aquí para abrir el chat en WhatsApp._`;

    // Se usa el formato 'text' simple para asegurar que el @channel funcione correctamente
    const slackPayload = {
        text: alertaTextoSinFormato,
        username: 'Boutique Bot Alerta',
        icon_emoji: ':robot_face:',
    };
    
    try {
        await axios.post(SLACK_WEBHOOK_URL, slackPayload);
        console.log('✅ Alerta de escalamiento enviada a Slack.');
    } catch (error) {
        console.error('❌ Error al notificar Slack:', error.message);
        throw new Error("SLACK_FAIL");
    }
}


/**
 * V33: Función unificada para enviar la bienvenida completa y registrarla en memoria.
 */
async function enviarBienvenidaCompleta(numero) {
    // --- MENSAJE DE BIENVENIDA (PRIMER PARTE) ---
    const mensajeDinamicaVideo = `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;
    const bienvenidaTextoParte1 = 
        `¡Hola, bienvenida a *Karen's Clothes*! Soy **Paola** y estoy encantada de atenderte. ✨\n\n` +
        `¿Tienes tienda o te manejas sobre pedido?\n\n` +
        `A continuación, te dejo nuestro link de nuestra página oficial: https://www.facebook.com/share/19928ADEfk/\n\n` + 
        mensajeDinamicaVideo; 

    // --- MENSAJE DE OFERTA (SEGUNDA PARTE) ---
    const bienvenidaTextoParte2 = 
        `¡Realiza tu **primera compra** y llévate un cupón! 🎁\n\n` +
        `1.-Cupón: Realiza una compra mínima de *$4000 MXN* se brinda el precio de corrida que son 10 pesos menos por prenda del precio de mayoreo\n\n` +
        `2.-Cupón: Realiza una compra mínima de *$6000 MXN* se brinda el precio de paquete que son 20 pesos menos por prenda del precio de mayoreo`;
    
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
            
            // ⬅️ V33: Normalización de números mexicanos a formato E.164 (521...)
            if (numero.length === 10 && !numero.startsWith('52')) {
                numero = '521' + numero;
                console.log(`✅ Número normalizado: Forzado a 521 + 10 dígitos -> ${numero}`);
            } else if (numero.length === 12 && numero.startsWith('521')) {
                console.log(`✅ Número ya normalizado: ${numero}`);
            }

            // ⬅️ V33: Bloqueo de JID/números excesivamente largos (se usa 15 para la protección)
            if (numero.length > 15) { 
                console.log(`❌ MENSAJE DE NUMERO EXCESIVAMENTE LARGO DETECTADO Y BLOQUEADO: ${numero}. JID INESPERADO.`);
                continue; 
            }
            // -------------------------------------------

            const textoLower = texto.toLowerCase();
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
                
            // --- CONSTANTE PARA SALUDO DE NÚMEROS EXISTENTES ---
            const mensajeSaludoExistente = `¡Hola, bienvenida de nuevo! 😊 ¿En qué puedo ayudarte hoy? Recuerda que nuestra dinámica de compra está en este video: ${VIDEO_BIENVENIDA_URL}`;
            
            const mensajeDinamicaVideo = `Por favor, tómate solo 30 segundos para ver nuestro video de bienvenida, ahí te explico nuestra dinámica: ${VIDEO_BIENVENIDA_URL}`;


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
                }
                await guardarMemoria();
                continue; 
            }

            // -------------------------------------------
            // 🚩 0.2 PRIORIDAD: BLOQUEO DE RESPUESTA REPETITIVA POST-ESCALAMIENTO 🚩
            // -------------------------------------------
            if (conversacionEnEscalamiento.has(numero)) {
                // Filtro simple para que el bot no espamee la respuesta de escala si el humano ya fue notificado.
                // Permite solo peticiones de pago/dinámica/cierre para no silenciar totalmente.
                const buscaReenvioPago = textoSinTildes.includes('pago') || 
                                         textoSinTildes.includes('cuenta') || 
                                         textoSinTildes.includes('clabe'); 
                                         
                const buscaCierre = textoSinTildes.includes('gracias') ||
                                    textoSinTildes.includes('ok') ||
                                    textoSinTildes.includes('saludos');

                if (buscaReenvioPago || buscaDinamica || buscaCierre) {
                    console.log("⭐ BYPASS P0.2: Pago/Dinámica/Cierre detectado. Cayendo a su prioridad específica.");
                    // Continúa la ejecución normal para P2 o P1.5
                } else {
                    console.log(`🔒 BLOQUEO DE RESPUESTA: Cliente ${numero} ya en escalamiento. Silenciando bot.`);
                    // Acción: Re-notificar Slack si insiste en escalar.
                    try {
                         await notificarSlack(numero, `REPETICIÓN DE INTENTO DE COMPRA/CONTACTO: "${texto}"`);
                    } catch (e) {
                        console.error('⚠️ Fallo en notificar Slack P0.2 Repetición:', e.message);
                    }
                    continue; // Detiene el flujo aquí
                }
            }


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
                
                conversacionEnEscalamiento.set(numero, Date.now()); 
                if(!bienvenidaEnviada.has(numero)) {
                    bienvenidaEnviada.set(numero, Date.now());
                }
                await guardarMemoria();

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
            
            // **CRÍTICO:** Solo entra aquí si el mensaje es un saludo SIMPLE Y YA ESTÁ EN MEMORIA PERSISTENTE.
            if (esSaludoSimple && bienvenidaEnviada.has(numero)) {
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
                
                // V33: Marcamos como "bienvenido" en la memoria si pide pago/dinámica.
                bienvenidaEnviada.set(numero, Date.now());
                await guardarMemoria();
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
                
                // V33: Marcamos como "bienvenido" en la memoria si pide pago/dinámica.
                bienvenidaEnviada.set(numero, Date.now());
                await guardarMemoria();
                continue; 
            }
            
            // -------------------------------------------
            // 🚩 3. PRIORIDAD: LÓGICA DE BIENVENIDA COMPLETA (SOLO CLIENTE NUEVO O REINICIADO) 🚩
            // -------------------------------------------
            
            // V33: Si el mensaje pasó por P1 y NO estaba en memoria PERSISTENTE, se asume que es nuevo
            if (!bienvenidaEnviada.has(numero)) { 
                console.log(`[FLOW] Cliente NUEVO o Reiniciado. Enviando flujo de bienvenida COMPLETA.`);
                await enviarBienvenidaCompleta(numero);
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

                conversacionEnEscalamiento.set(numero, Date.now()); 
                await guardarMemoria();

            } else {
                // Si la IA no escaló, simplemente responde amablemente.
                respuesta = respuestaIA;
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
    await cargarMemoria(); // ⬅️ V33: Carga la memoria al inicio
    console.log(`🤖 Chatbot activo en puerto ${PORT}.`);
});
