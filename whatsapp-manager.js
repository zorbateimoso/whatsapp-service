const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'https://obramanager.com.br';

class WhatsAppManager {
  constructor() {
    this.clients = new Map();
    this.qrCodes = new Map();
  }

  getClient(userId) {
    if (!this.clients.has(userId)) {
      console.log(`📱 Creating new WhatsApp client for user ${userId}`);
      const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
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

      this._setupClientHandlers(client, userId);
      client.initialize();
      this.clients.set(userId, client);
    }
    return this.clients.get(userId);
  }

  _setupClientHandlers(client, userId) {
    client.on('qr', async (qr) => {
      console.log(`📱 QR Code generated for user ${userId}`);
      try {
        const qrImage = await qrcode.toDataURL(qr);
        this.qrCodes.set(userId, qrImage);
      } catch (err) {
        console.error('Error generating QR code image:', err);
        this.qrCodes.set(userId, qr);
      }
    });

    client.on('ready', () => {
      console.log(`✅ WhatsApp ready for user ${userId}`);
      this.qrCodes.delete(userId);
    });

    client.on('authenticated', () => {
      console.log(`✅ WhatsApp authenticated for user ${userId}`);
      this.qrCodes.delete(userId);
    });

    client.on('auth_failure', (msg) => {
      console.error(`❌ Auth failure for user ${userId}:`, msg);
    });

    client.on('disconnected', (reason) => {
      console.log(`⚠️ WhatsApp disconnected for user ${userId}:`, reason);
    });

    client.on('message', async (msg) => {
      try {
        console.log(`📩 Message received for user ${userId}:`, {
          from: msg.from,
          body: msg.body,
          hasMedia: msg.hasMedia
        });

        const contact = await msg.getContact();
        const chat = await msg.getChat();
        
        let messageType = 'text';
        if (msg.hasMedia) {
          if (msg.type === 'image') messageType = 'image';
          else if (msg.type === 'ptt' || msg.type === 'audio') messageType = 'audio';
          else messageType = 'document';
        }

        const webhookData = {
          user_id: userId,
          group_name: chat.name || contact.pushname || 'WhatsApp',
          group_id: msg.from,
          sender: msg.author || msg.from,
          sender_name: contact.pushname || 'Usuário',
          timestamp: new Date().toISOString(),
          type: messageType,
          text: msg.body || null
        };

        if (msg.hasMedia) {
          try {
            const media = await msg.downloadMedia();
            webhookData.media = media.data;
            webhookData.media_mime = media.mimetype;
            webhookData.media_filename = media.filename || `file.${media.mimetype.split('/')[1]}`;
            console.log('📎 Media downloaded:', { 
              type: webhookData.type, 
              mime: webhookData.media_mime, 
              size: webhookData.media.length 
            });
          } catch (error) {
            console.error('❌ Error downloading media:', error);
          }
        }

        console.log('📤 Sending to backend:', BACKEND_URL + '/api/whatsapp/webhook');
        console.log('📋 Data:', {
          user_id: webhookData.user_id,
          group_name: webhookData.group_name,
          type: webhookData.type,
          text: webhookData.text ? webhookData.text.substring(0, 50) : null,
          has_media: !!webhookData.media
        });

        const response = await axios.post(
          BACKEND_URL + '/api/whatsapp/webhook',
          webhookData,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
          }
        );

        console.log('✅ Backend response:', response.data);

        const { reply_message } = response.data;

        if (reply_message) {
          await msg.reply(reply_message);
          console.log('📨 Reply sent to user');
        } else {
          console.log('ℹ️ Backend did not return a message');
        }

      } catch (error) {
        console.error('❌ Error processing message:', error.message);
        
        try {
          await msg.reply('❌ Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente em alguns instantes.');
        } catch (replyError) {
          console.error('❌ Error sending error message:', replyError);
        }
      }
    });
  }

  async getStatus(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      return { status: 'not_initialized' };
    }

    try {
      const state = await client.getState();
      return {
        status: state === 'CONNECTED' ? 'connected' : 'disconnected',
        state: state
      };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  getQRCode(userId) {
    return this.qrCodes.get(userId) || null;
  }

  async getGroups(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      throw new Error('Client not initialized for this user');
    }

    try {
      const chats = await client.getChats();
      const groups = chats
        .filter(chat => chat.isGroup)
        .map(chat => ({
          id: chat.id._serialized,
          name: chat.name
        }));
      
      return groups;
    } catch (error) {
      throw new Error(`Failed to get groups: ${error.message}`);
    }
  }

  async logout(userId) {
    const client = this.clients.get(userId);
    if (client) {
      try {
        await client.logout();
        await client.destroy();
        this.clients.delete(userId);
        this.qrCodes.delete(userId);
        console.log(`✅ User ${userId} logged out`);
      } catch (error) {
        console.error(`❌ Error logging out user ${userId}:`, error);
        throw error;
      }
    }
  }

  async destroy() {
    console.log('🛑 Destroying all WhatsApp clients...');
    for (const [userId, client] of this.clients.entries()) {
      try {
        await client.destroy();
        console.log(`✅ Client for user ${userId} destroyed`);
      } catch (error) {
        console.error(`❌ Error destroying client for user ${userId}:`, error);
      }
    }
    this.clients.clear();
    this.qrCodes.clear();
  }
}

module.exports = WhatsAppManager;
