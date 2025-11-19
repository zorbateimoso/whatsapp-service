const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');

class WhatsAppManager {
  constructor() {
    this.clients = new Map(); // userId -> client instance
    this.qrCodes = new Map(); // userId -> qr code
    this.fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8001';
  }

  // Get or create client for a user
  getClient(userId) {
    if (!this.clients.has(userId)) {
      console.log(`🔧 Creating new WhatsApp client for user: ${userId}`);
      this.createClient(userId);
    }
    return this.clients.get(userId);
  }

  // Create a new client instance for a user
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

    // Setup event handlers for this client
    this.setupEventHandlers(client, userId);
    
    // Store client
    this.clients.set(userId, client);
    
    // Initialize
    client.initialize();
    
    return client;
  }

  setupEventHandlers(client, userId) {
    // QR code generation
    client.on('qr', async (qr) => {
      console.log(`📱 QR Code received for user: ${userId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.qrCodes.set(userId, qrDataUrl);
        console.log(`✅ QR Code generated for user: ${userId}`);
      } catch (error) {
        console.error(`❌ Error generating QR code for user ${userId}:`, error);
      }
    });

    // Ready event
    client.on('ready', () => {
      console.log(`✅ WhatsApp client ready for user: ${userId}`);
      this.qrCodes.delete(userId); // Clear QR code when connected
    });

    // Authenticated event
    client.on('authenticated', () => {
      console.log(`🔐 WhatsApp authenticated for user: ${userId}`);
    });

    // Authentication failure
    client.on('auth_failure', (msg) => {
      console.error(`❌ Authentication failure for user ${userId}:`, msg);
    });

    // Disconnected event
    client.on('disconnected', (reason) => {
      console.log(`⚠️ WhatsApp disconnected for user ${userId}:`, reason);
      this.clients.delete(userId);
      this.qrCodes.delete(userId);
    });

    // ✅ UNIFIED MESSAGE HANDLER - Single point of control
    client.on('message', async (message) => {
      try {
        // ⚡ FIX: IGNORAR MENSAGENS ANTIGAS (mais de 1 minuto)
        const messageTimestamp = message.timestamp * 1000;
        const now = Date.now();
        const messageAge = now - messageTimestamp;
        const oneMinute = 60 * 1000;
        
        if (messageAge > oneMinute) {
          console.log(`⏭️ [User ${userId}] Ignoring old message (${Math.floor(messageAge / 1000)}s ago)`);
          return;
        }
        
        const chat = await message.getChat();
        if (!chat.isGroup) {
          console.log('⚠️ Message not from a group, skipping...');
          return;
        }

        const contact = await message.getContact();
        const messageText = (message.body || '').trim().toLowerCase();
        
        // PRIORITY 1: Check for category selection responses (Material / Mão de Obra)
        if (messageText === 'material' || messageText === 'mao de obra' || messageText === 'mão de obra') {
          console.log(`📊 [User ${userId}] Category response detected: ${messageText}`);
          await this.handleCategoryResponse(message, contact, chat, userId);
          return;
        }
        
        // PRIORITY 2: Check for validation responses (Sim/Não/Editar)
        if (messageText === 'sim' || messageText === 'não' || messageText === 'nao' || messageText === 'editar') {
          console.log(`📊 [User ${userId}] Validation response detected: ${messageText}`);
          await this.handleValidationResponse(message, contact, chat, userId);
          return;
        }
        
        // PRIORITY 3: Regular messages (documents, commands, context)
        await this.handleMessage(message, userId);
        
      } catch (error) {
        console.error(`❌ [User ${userId}] Error in unified message handler:`, error);
      }
    });
  }

  async handleMessage(message, userId) {
    try {
      const chat = await message.getChat();
      
      console.log(`📨 [User ${userId}] Processing regular message from group: ${chat.name}`);
      console.log(`📝 [User ${userId}] Message type: ${message.type}`);
      console.log(`📝 [User ${userId}] Message hasMedia: ${message.hasMedia}`);
      console.log(`📝 [User ${userId}] Message text: ${message.body ? message.body.substring(0, 50) : 'no text'}...`);

      const contact = await message.getContact();
      let mediaBase64 = null;
      let mediaMime = null;
      let mediaFilename = null;

      // Download media if exists
      if (message.hasMedia) {
        console.log(`📎 [User ${userId}] Downloading media (type: ${message.type})...`);
        const media = await message.downloadMedia();
        mediaBase64 = media.data;
        mediaMime = media.mimetype;
        mediaFilename = media.filename || `file_${Date.now()}`;
        console.log(`✅ [User ${userId}] Media downloaded - mime: ${mediaMime}, size: ${mediaBase64 ? mediaBase64.length : 0} bytes`);
      }

      // Send to backend
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

      console.log(`📡 [User ${userId}] Sending message to backend webhook...`);
      const response = await axios.post(`${this.fastApiUrl}/api/whatsapp/webhook`, messageData);
      console.log(`✅ [User ${userId}] Backend response received - Status: ${response.data.status}`);
      
      // Handle command responses (diary, cadastro, report, query, etc)
      const commandStatuses = [
        'diary_started', 
        'diary_ended', 
        'info', 
        'report_generated',
        'registration_mode_activated',
        'registration_completed',
        'registration_failed',
        'registration_cancelled',
        'context_learned',
        'query_response',  // Financial queries in natural language
        'phone_registered',  // Phone number registration
        'phone_already_registered',  // Phone already exists
        'pending_validation'  // Upload validation message
      ];
      
      if (commandStatuses.includes(response.data.status)) {
        console.log(`📤 [User ${userId}] Command status detected: ${response.data.status}`);
        
        if (response.data.message) {
          const msgPreview = response.data.message.substring(0, 100);
          console.log(`📤 [User ${userId}] Sending message to group: "${msgPreview}..."`);
          await this.clients.get(userId).sendMessage(chat.id._serialized, response.data.message);
          console.log(`✅ [User ${userId}] Message sent successfully to WhatsApp`);
        } else {
          console.log(`⚠️ [User ${userId}] No message field in response for status: ${response.data.status}`);
        }
        return;
      }
      
      // Handle duplicate confirmation needed
      if (response.data.status === 'needs_duplicate_confirmation') {
        console.log(`⚠️ Duplicate confirmation needed`);
        const duplicateMessage = response.data.message || 'Duplicata detectada. Deseja continuar?';
        await this.clients.get(userId).sendMessage(chat.id._serialized, duplicateMessage);
        console.log(`✅ Duplicate confirmation message sent`);
        return;
      }
      
      // Handle category selection needed (ambiguous category)
      if (response.data.status === 'needs_category_selection' && response.data.processed_info) {
        console.log(`⚠️ Category selection needed`);
        
        // Use custom message from backend if available, otherwise build default message
        let categoryMessage;
        if (response.data.message) {
          categoryMessage = response.data.message;
        } else {
          const info = response.data.processed_info;
          categoryMessage = `⚠️ *CATEGORIA AMBÍGUA*\n\n`;
          categoryMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
          categoryMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
          categoryMessage += `📅 Data: ${info.data || 'N/A'}\n`;
          if (info.descricao) categoryMessage += `📝 ${info.descricao}\n`;
          if (info.pagador) categoryMessage += `💳 Pagador: ${info.pagador}\n`;
          categoryMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
          categoryMessage += `Este lançamento pode ser Material ou Mão de Obra.\n`;
          categoryMessage += `Por favor, escolha a categoria:\n\n`;
          categoryMessage += `🧱 *Material* - Digite: material\n`;
          categoryMessage += `👷 *Mão de Obra* - Digite: mao de obra`;
        }
        
        await this.clients.get(userId).sendMessage(chat.id._serialized, categoryMessage);
        console.log(`✅ Category selection message sent`);
        return;
      }
      
      // Handle diary entry saved (no need to send message)
      if (response.data.status === 'diary_entry_saved') {
        return;
      }
      
      if (response.data.validation_required && response.data.processed_info) {
        const info = response.data.processed_info;
        let validationMessage = `🔍 *VALIDAÇÃO PENDENTE*\n\n`;
        validationMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
        validationMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
        validationMessage += `📅 Data: ${info.data || 'N/A'}\n`;
        validationMessage += `📝 ${info.descricao || 'Sem descrição'}\n`;
        validationMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
        validationMessage += `Para autorizar o lançamento, responda:\n`;
        validationMessage += `✅ *Sim* - Aprovar\n`;
        validationMessage += `❌ *Não* - Rejeitar\n`;
        validationMessage += `✏️ *Editar* - Edição manual`;
        
        await this.clients.get(userId).sendMessage(chat.id._serialized, validationMessage);
      }
    } catch (error) {
      console.error(`❌ Error handling message for user ${userId}:`, error);
    }
  }

  async handleCategoryResponse(message, contact, chat, userId) {
    try {
      const messageText = (message.body || '').trim().toLowerCase();
      
      let selectedOption;
      if (messageText === 'material') {
        selectedOption = '0'; // Material
      } else if (messageText === 'mao de obra' || messageText === 'mão de obra') {
        selectedOption = '1'; // Mão de Obra
      } else {
        return;
      }

      console.log(`✅ Category response: ${messageText.toUpperCase()} by ${contact.pushname || contact.name} (User: ${userId})`);

      const categoryResponse = await axios.post(`${this.fastApiUrl}/api/whatsapp/category-selection`, {
        poll_id: 'category_selection',
        voter: contact.id._serialized,
        voter_name: contact.pushname || contact.name || 'Unknown',
        selected_option: selectedOption,
        group_id: chat.id._serialized
      });

      console.log('✅ Category selection sent to backend');

      // ✅ Send next validation if it exists in queue (after category selection)
      if (categoryResponse.data && categoryResponse.data.next_validation) {
        console.log('📨 Next validation in queue after category, sending poll...');
        const next = categoryResponse.data.next_validation;
        const info = next.processed_info || {};
        
        if (next.needs_category_selection) {
          let categoryMessage = `📊 *NOVA VALIDAÇÃO - SELECIONE A CATEGORIA*\n\n`;
          categoryMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
          categoryMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
          categoryMessage += `📅 Data: ${info.data || 'N/A'}\n`;
          if (info.descricao) categoryMessage += `📝 ${info.descricao}\n`;
          if (info.pagador) categoryMessage += `💳 Pagador: ${info.pagador}\n`;
          categoryMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
          categoryMessage += `⚠️ Não consegui determinar a categoria com certeza.\n`;
          categoryMessage += `Por favor, responda:\n`;
          categoryMessage += `🧱 *Material*\n`;
          categoryMessage += `👷 *Mão de Obra*`;
          
          await this.clients.get(userId).sendMessage(chat.id._serialized, categoryMessage);
        } else {
          let validationMessage = `🔍 *NOVA VALIDAÇÃO PENDENTE*\n\n`;
          validationMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
          validationMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
          validationMessage += `📅 Data: ${info.data || 'N/A'}\n`;
          if (info.categoria) validationMessage += `📋 Categoria: ${info.categoria}\n`;
          if (info.descricao) validationMessage += `📝 ${info.descricao}\n`;
          if (info.pagador) validationMessage += `💳 Pagador: ${info.pagador}\n`;
          validationMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
          validationMessage += `Para autorizar o lançamento, responda:\n`;
          validationMessage += `✅ *Sim* - Aprovar\n`;
          validationMessage += `❌ *Não* - Rejeitar\n`;
          validationMessage += `✏️ *Editar* - Edição manual`;
          
          await this.clients.get(userId).sendMessage(chat.id._serialized, validationMessage);
        }
      }
      
      // If backend requests to send validation poll after category is set (legacy)
      if (categoryResponse.data && categoryResponse.data.send_validation_poll) {
        console.log('📤 Sending validation poll after category selection...');
        const info = categoryResponse.data.processed_info || {};
        
        let validationMessage = `🔍 *VALIDAÇÃO PENDENTE*\n\n`;
        validationMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
        validationMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
        validationMessage += `📅 Data: ${info.data || 'N/A'}\n`;
        if (info.categoria) validationMessage += `📋 Categoria: ${info.categoria}\n`;
        if (info.descricao) validationMessage += `📝 ${info.descricao}\n`;
        if (info.pagador) validationMessage += `💳 Pagador: ${info.pagador}\n`;
        validationMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
        validationMessage += `Para autorizar o lançamento, responda:\n`;
        validationMessage += `✅ *Sim* - Aprovar\n`;
        validationMessage += `❌ *Não* - Rejeitar\n`;
        validationMessage += `✏️ *Editar* - Edição manual`;
        
        await this.clients.get(userId).sendMessage(chat.id._serialized, validationMessage);
        console.log('✅ Validation poll sent after category selection');
      }
    } catch (error) {
      console.error('❌ Error handling category response:', error);
    }
  }

  async handleValidationResponse(message, contact, chat, userId) {
    try {
      const messageText = (message.body || '').trim().toLowerCase();
      
      let selectedOption;
      if (messageText === 'sim') {
        selectedOption = '0';
      } else if (messageText === 'não' || messageText === 'nao') {
        selectedOption = '1';
      } else if (messageText === 'editar') {
        selectedOption = '2';
      } else {
        return;
      }

      console.log(`✅ Validation response: ${messageText.toUpperCase()} by ${contact.pushname || contact.name} (User: ${userId})`);
      console.log(`📡 Sending poll-vote to backend: ${this.fastApiUrl}/api/whatsapp/poll-vote`);

      const voteResponse = await axios.post(`${this.fastApiUrl}/api/whatsapp/poll-vote`, {
        poll_id: 'text_validation',
        voter: contact.id._serialized,
        voter_name: contact.pushname || contact.name || 'Unknown',
        selected_option: selectedOption,
        group_id: chat.id._serialized
      });
      
      console.log(`📥 Poll-vote response:`, JSON.stringify(voteResponse.data));

      // Handle different response statuses
      if (voteResponse.data.status === 'needs_category') {
        // User confirmed duplicate, now needs to select category
        const categoryMessage = voteResponse.data.message || 'Por favor, selecione a categoria:\n\n🧱 *Material*\n👷 *Mão de Obra*';
        await this.clients.get(userId).sendMessage(chat.id._serialized, categoryMessage);
        return;
      }
      
      if (voteResponse.data.status === 'needs_validation') {
        // User confirmed duplicate, now needs final validation
        const validationMessage = voteResponse.data.message;
        await this.clients.get(userId).sendMessage(chat.id._serialized, validationMessage);
        return;
      }
      
      if (voteResponse.data.status === 'rejected') {
        // User rejected duplicate
        const rejectionMessage = voteResponse.data.message || '❌ Lançamento cancelado.';
        await this.clients.get(userId).sendMessage(chat.id._serialized, rejectionMessage);
        // Process next validation if exists
        if (voteResponse.data && voteResponse.data.next_validation) {
          // Handle next validation (code below)
        }
        return;
      }

      if (voteResponse.data && voteResponse.data.send_confirmation) {
        const valor = voteResponse.data.valor || 'N/A';
        await this.clients.get(userId).sendMessage(chat.id._serialized, `✅ Pagamento ${valor} lançado.`);
      }

      if (voteResponse.data && voteResponse.data.send_message) {
        const editMessage = `✏️ *EDIÇÃO MANUAL SOLICITADA*\n\nPor favor, adicione o gasto manualmente no sistema.\n\nO sistema não conseguiu processar automaticamente este documento.\nAcesse o painel web para inserir os dados manualmente.`;
        await this.clients.get(userId).sendMessage(chat.id._serialized, editMessage);
      }

      // ✅ Send next validation if it exists in queue
      if (voteResponse.data && voteResponse.data.next_validation) {
        console.log('📨 Next validation in queue, sending poll...');
        const next = voteResponse.data.next_validation;
        const info = next.processed_info || {};
        
        if (next.needs_category_selection) {
          // Send category selection poll
          let categoryMessage = `📊 *NOVA VALIDAÇÃO - SELECIONE A CATEGORIA*\n\n`;
          categoryMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
          categoryMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
          categoryMessage += `📅 Data: ${info.data || 'N/A'}\n`;
          if (info.descricao) categoryMessage += `📝 ${info.descricao}\n`;
          if (info.pagador) categoryMessage += `💳 Pagador: ${info.pagador}\n`;
          categoryMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
          categoryMessage += `⚠️ Não consegui determinar a categoria com certeza.\n`;
          categoryMessage += `Por favor, responda:\n`;
          categoryMessage += `🧱 *Material*\n`;
          categoryMessage += `👷 *Mão de Obra*`;
          
          await this.clients.get(userId).sendMessage(chat.id._serialized, categoryMessage);
        } else {
          // Send validation poll
          let validationMessage = `🔍 *NOVA VALIDAÇÃO PENDENTE*\n\n`;
          validationMessage += `📄 Tipo: ${info.tipo_documento || 'não identificado'}\n`;
          validationMessage += `💰 Valor: ${info.valor || 'N/A'}\n`;
          validationMessage += `📅 Data: ${info.data || 'N/A'}\n`;
          if (info.categoria) validationMessage += `📋 Categoria: ${info.categoria}\n`;
          if (info.descricao) validationMessage += `📝 ${info.descricao}\n`;
          if (info.pagador) validationMessage += `💳 Pagador: ${info.pagador}\n`;
          validationMessage += `\n━━━━━━━━━━━━━━━━━━\n\n`;
          validationMessage += `Para autorizar o lançamento, responda:\n`;
          validationMessage += `✅ *Sim* - Aprovar\n`;
          validationMessage += `❌ *Não* - Rejeitar\n`;
          validationMessage += `✏️ *Editar* - Edição manual`;
          
          await this.clients.get(userId).sendMessage(chat.id._serialized, validationMessage);
        }
      }
    } catch (error) {
      console.error(`❌ Error handling validation response for user ${userId}:`, error);
    }
  }

  // Get QR code for a user
  getQRCode(userId) {
    return this.qrCodes.get(userId) || null;
  }

  // Get status for a user
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
      // Client is initializing
      return {
        connected: false,
        hasQR: this.qrCodes.has(userId),
        client_state: 'initializing'
      };
    }
  }

  // Get groups for a user
  async getGroups(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      throw new Error('WhatsApp not initialized for this user');
    }

    const chats = await client.getChats();
    
    // Filter only ACTIVE groups (where user is still a participant)
    const groups = [];
    for (const chat of chats) {
      if (chat.isGroup) {
        try {
          // Check if group still exists and user is participant
          const groupChat = await client.getChatById(chat.id._serialized);
          
          // Only include if user is participant (not left/removed)
          if (groupChat && groupChat.participants) {
            const myNumber = client.info.wid._serialized;
            const isParticipant = groupChat.participants.some(p => 
              p.id._serialized === myNumber
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
          // Group no longer exists or error accessing it - skip
          console.log(`⚠️ Skipping group ${chat.name}: ${error.message}`);
        }
      }
    }

    return groups;
  }

  // Logout user
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
