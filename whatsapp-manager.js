# 📥 Pronto! Agora você pode baixar o arquivo:

## 🔗 Link para Download:

```
https://obramanager.com.br/whatsapp-manager.js
```

## 📋 Ou copie direto daqui:
Action: $ cat /app/frontend/public/whatsapp-manager.js
Observation: /**
 * WHATSAPP MANAGER - VERSÃO SIMPLES (RELAY BURRO)
 * 
 * Esta versão é um "relay burro" - apenas conecta com WhatsApp e encaminha mensagens.
 * TODA a lógica de decisão fica no backend (Emergent).
 * 
 * VANTAGENS:
 * - Nunca mais precisar atualizar este código
 * - Toda lógica centralizada no backend
 * - Mais fácil de testar e manter
 * - Performance: impacto mínimo
 * 
 * COMO FUNCIONA:
 * 1. Recebe mensagem do WhatsApp
 * 2. Envia para o backend processar
 * 3. Se o backend retornar "reply_message", envia de volta
 * 4. Fim!
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://obramanager.com.br';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('📱 Escaneie o QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp conectado e pronto!');
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp desconectado:', reason);
});

client.on('message', async (msg) => {
    try {
        console.log('📩 Mensagem recebida:', {
            from: msg.from,
            body: msg.body,
            hasMedia: msg.hasMedia
        });

        // Enviar para o backend processar
        const webhookData = {
            from: msg.from,
            body: msg.body,
            sender_name: (await msg.getContact()).pushname || 'Usuário',
            message_type: msg.hasMedia ? 'media' : 'text',
            timestamp: Date.now(),
            group_id: msg.from
        };

        // Se tem mídia, baixar e enviar
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                webhookData.media = {
                    mimetype: media.mimetype,
                    data: media.data,
                    filename: media.filename || 'file'
                };
                webhookData.message_type = media.mimetype.startsWith('image/') ? 'image' : 
                                          media.mimetype.startsWith('audio/') ? 'audio' : 
                                          'document';
            } catch (error) {
                console.error('Erro ao baixar mídia:', error);
            }
        }

        console.log('📤 Enviando para backend:', BACKEND_URL + '/api/whatsapp/webhook');

        const response = await axios.post(
            BACKEND_URL + '/api/whatsapp/webhook',
            webhookData,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000
            }
        );

        console.log('✅ Resposta do backend:', response.data);

        // ⭐ SIMPLES: Se o backend retornar "reply_message", enviar ao usuário
        // NÃO tomamos NENHUMA decisão aqui!
        const { reply_message } = response.data;

        if (reply_message) {
            await msg.reply(reply_message);
            console.log('📨 Resposta enviada ao usuário');
        } else {
            console.log('ℹ️ Backend não retornou mensagem para enviar');
        }

    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error.message);
        
        // Apenas em caso de erro crítico, enviar mensagem genérica
        try {
            await msg.reply('❌ Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente em alguns instantes.');
        } catch (replyError) {
            console.error('❌ Erro ao enviar mensagem de erro:', replyError);
        }
    }
});

// Inicializar cliente
console.log('🚀 Iniciando WhatsApp Service...');
console.log('📡 Backend URL:', BACKEND_URL);
client.initialize();

// Health check endpoint (para status no Railway)
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

app.get('/health', (req, res) => {
    const isReady = client.info !== null;
    res.json({
        status: isReady ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Health check rodando na porta ${PORT}`);
});
Exit code: 0
