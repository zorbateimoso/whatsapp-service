const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');

class WhatsAppManager {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
    this.fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8001';
  }

  getClient(userId) {
    if (!this.clients.has(userId)) {
      console.log(`🔧 Creating new WhatsApp client for user: ${userId}`);
      this.createClient(userId);
    }
    return this.clients.get(userId);
  }

  createClient(userId) {
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: `./.wwebjs_auth`
      }),
      puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions'
        ]
      }
    });

    this.setupEventHandlers(client, userId);
    this.clients.set(userId, client);
    client.initialize();
    return client;
  }

  setupEventHandlers(client, userId) {
    client.on('qr', async (qr) => {
      console.log(`📱 QR Code received for user: ${userId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.qrCodes.set(userId, qrDataUrl);
        console.log(`✅ QR Code generated for user: ${userId}`);
      } catch (error) {
        console.error(`❌ Error generating QR code:`, error);
      }
    });

    client.on('ready', () => {
      console.log(`✅ WhatsApp client ready for user: ${userId}`);
      this.qrCodes.delete(userId);
    });

    client.on('authenticated', () => {
      console.log(`🔐 WhatsApp authenticated for user: ${userId}`);
    });

    client.on('auth_failure', (msg) => {
      console.error(`❌ Authentication failure:`, msg);
    });

    client.on('disconnected', (reason) => {
      console.log(`⚠️ WhatsApp disconnected:`, reason);
      this.clients.delete(userId);
      this.qrCodes.delete(userId);
    });

    // ⭐ ÚNICO HANDLER - SEM LÓGICA DE DECISÃO
    client.on('message', async (message) => {
      try {
        // Ignorar mensagens antigas (> 1 minuto)
        const messageAge = Date.now() - (message.timestamp * 1000);
        if (messageAge > 60000) {
          console.log(`⏭️ Ignoring old message (${Math.floor(messageAge/1000)}s ago)`);
          return;
        }

        const chat = await message.getChat();
        if (!chat.isGroup) {
          console.log('⚠️ Not a group message, skipping');
          return;
        }

        console.log(`📩 Message received from: ${chat.name}`);

        // Preparar dados
        const contact = await message.getContact();
        let mediaBase64 = null;
        let mediaMime = null;
        let mediaFilename = null;

        if (message.hasMedia) {
          console.log(`📎 Downloading media...`);
          const media = await message.downloadMedia();
          mediaBase64 = media.data;
          mediaMime = media.mimetype;
          mediaFilename = media.filename || `file_${Date.now()}`;
        }

        // Montar payload
        const messageData = {
          user_id: userId,
          group_id: chat.id._serialized,
          group_name: chat.name,
          sender: contact.id._serialized,
          sender_name: contact.pushname || contact.name || 'Unknown',
          timestamp: new Date().toISOString(),
          type: message.type,
          text: message.body || null,
          media: mediaBase64,
          media_mime: mediaMime,
          media_filename: mediaFilename,
          validation_required: true
        };

        // Enviar pro backend
        console.log(`📤 Sending to backend...`);
        const response = await axios.post(
          `${this.fastApiUrl}/api/whatsapp/webhook`,
          messageData,
          { timeout: 60000 }
        );

        console.log(`✅ Backend response received`);

        // ⭐ SIMPLES: Se tem reply_message, envia. FIM!
        if (response.data.reply_message) {
          await client.sendMessage(chat.id._serialized, response.data.reply_message);
          console.log(`📨 Reply sent to WhatsApp`);
        } else {
          console.log(`ℹ️ No reply_message from backend`);
        }

      } catch (error) {
        console.error(`❌ Error processing message:`, error.message);
        
        try {
          const chat = await message.getChat();
          await client.sendMessage(
            chat.id._serialized,
            '❌ Erro ao processar mensagem. Tente novamente.'
          );
        } catch (replyError) {
          console.error(`❌ Could not send error message`);
        }
      }
    });
  }

  getQRCode(userId) {
    return this.qrCodes.get(userId) || null;
  }

  async getStatus(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      return {
        connected: false,
        hasQR: false,
        client_state: 'not_initialized'
      };
    }

    try {
      const state = await client.getState();
      return {
        connected: state === 'CONNECTED',
        hasQR: this.qrCodes.has(userId),
        client_state: state
      };
    } catch (error) {
      return {
        connected: false,
        hasQR: this.qrCodes.has(userId),
        client_state: 'initializing'
      };
    }
  }

  async getGroups(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      throw new Error('WhatsApp not initialized');
    }

    const chats = await client.getChats();
    const groups = [];

    for (const chat of chats) {
      if (chat.isGroup) {
        try {
          const groupChat = await client.getChatById(chat.id._serialized);
          if (groupChat && groupChat.participants) {
            const myNumber = client.info.wid._serialized;
            const isParticipant = groupChat.participants.some(
              p => p.id._serialized === myNumber
            );
            if (isParticipant) {
              groups.push({
                id: chat.id._serialized,
                name: chat.name,
                participants: chat.participants.length
              });
            }
          }
        } catch (error) {
          console.log(`⚠️ Skipping group: ${chat.name}`);
        }
      }
    }

    return groups;
  }

  async logout(userId) {
    const client = this.clients.get(userId);
    if (client) {
      await client.logout();
      this.clients.delete(userId);
      this.qrCodes.delete(userId);
    }
  }
}

module.exports = WhatsAppManager;
