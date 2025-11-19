const { Client, LocalAuth, MessageMedia, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.qrCode = null;
    this.isReady = false;
    this.fastApiUrl = process.env.FASTAPI_URL || 'http://localhost:8001';
  }

  initialize() {
    console.log('🔧 Initializing WhatsApp client...');
    
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
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
          '--user-data-dir=./session/chromium_profile',
          '--disable-software-rasterizer',
          '--disable-extensions'
        ]
      }
    });

    this.setupEventHandlers();
    this.client.initialize();
  }

  setupEventHandlers() {
    // QR code generation
    this.client.on('qr', async (qr) => {
      console.log('📱 QR Code received');
      try {
        this.qrCode = await qrcode.toDataURL(qr);
        console.log('✅ QR Code generated successfully');
      } catch (err) {
        console.error('❌ Error generating QR code:', err);
      }
    });

    // Client ready
    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      this.qrCode = null;
    });

    // Authentication
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authenticated');
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failure:', msg);
      this.isReady = false;
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp disconnected:', reason);
      this.isReady = false;
      this.qrCode = null;
    });

    // Message received
    this.client.on('message', async (message) => {
      await this.handleMessage(message);
    });

    // Poll vote update (DISABLED - now using text-based validation)
    // this.client.on('vote_update', async (vote) => {
    //   await this.handlePollVote(vote);
    // });
  }

  async sendPollToGroup(groupId, question, options) {
    try {
      const poll = new Poll(question, options, {
        allowMultipleAnswers: false
      });
      
      const sentMessage = await this.client.sendMessage(groupId, poll);
      console.log('✅ Poll sent to group:', sentMessage.id._serialized);
      return sentMessage;
    } catch (error) {
      console.error('❌ Error sending poll:', error);
      throw error;
    }
  }

  async sendMessageToGroup(groupId, text) {
    try {
      await this.client.sendMessage(groupId, text);
      console.log('✅ Message sent to group');
    } catch (error) {
      console.error('❌ Error sending message:', error);
    }
  }

  async handleCategoryResponse(message, contact, chat) {
    try {
      const messageText = (message.body || '').trim().toLowerCase();
      
      // Map text to category option
      let selectedOption;
      if (messageText === 'material' || messageText === '1') {
        selectedOption = '0'; // Material
      } else if (messageText === 'mao de obra' || messageText === 'mão de obra' || messageText === 'mao' || messageText === '2') {
        selectedOption = '1'; // Mão de Obra
      } else {
        return; // Invalid response
      }
      
      console.log(`✅ Category response: ${messageText.toUpperCase()} (option ${selectedOption}) by ${contact.pushname || contact.name}`);
      
      // Send to backend category selection endpoint
      const categoryResponse = await axios.post(`${this.fastApiUrl}/api/whatsapp/category-selection`, {
        poll_id: 'category_selection',
        voter: contact.id._serialized,
        voter_name: contact.pushname || contact.name || 'Unknown',
        selected_option: selectedOption,
        group_id: chat.id._serialized
      });
      
      console.log('✅ Category selection sent to backend');
      
      // If backend requests to send validation poll (after category is set)
      if (categoryResponse.data && categoryResponse.data.send_validation_poll) {
        console.log('📤 Sending validation poll after category selection...');
        const processedInfo = categoryResponse.data.processed_info || {};
        
        await this.sendValidationPoll(chat.id._serialized, processedInfo, contact.pushname || contact.name);
      }
      
    } catch (error) {
      console.error('❌ Error handling category response:', error);
    }
  }

  async handleValidationResponse(message, contact, chat) {
    try {
      const messageText = (message.body || '').trim().toLowerCase();
      
      // Map text to option index
      let selectedOption;
      if (messageText === 'sim') {
        selectedOption = '0'; // SIM
      } else if (messageText === 'não' || messageText === 'nao') {
        selectedOption = '1'; // NAO
      } else if (messageText === 'editar') {
        selectedOption = '2'; // EDITAR
      } else {
        return; // Invalid response
      }
      
      console.log(`✅ Validation response: ${messageText.toUpperCase()} (option ${selectedOption}) by ${contact.pushname || contact.name}`);
      
      // Send to backend
      const voteResponse = await axios.post(`${this.fastApiUrl}/api/whatsapp/poll-vote`, {
        poll_id: 'text_validation',
        voter: contact.id._serialized,
        voter_name: contact.pushname || contact.name || 'Unknown',
        selected_option: selectedOption,
        group_id: chat.id._serialized
      });
      
      console.log('✅ Validation response sent to backend');
      
      // If backend requests to send confirmation (e.g., for SIM - approved)
      if (voteResponse.data && voteResponse.data.send_confirmation) {
        console.log('📤 Sending payment confirmation message...');
        const groupId = voteResponse.data.group_id;
        const valor = voteResponse.data.valor || 'N/A';
        const confirmationMessage = `✅ Pagamento ${valor} lançado.`;
        
        await this.client.sendMessage(groupId, confirmationMessage);
        console.log('✅ Payment confirmation message sent');
      }
      
      // If backend requests to send a message (e.g., for EDITAR option)
      if (voteResponse.data && voteResponse.data.send_message) {
        console.log('📤 Sending edit instruction message...');
        const groupId = voteResponse.data.group_id;
        const editMessage = `✏️ *EDIÇÃO MANUAL SOLICITADA*\n\n` +
          `Por favor, adicione o gasto manualmente no sistema.\n\n` +
          `O sistema não conseguiu processar automaticamente este documento.\n` +
          `Acesse o painel web para inserir os dados manualmente.`;
        
        await this.client.sendMessage(groupId, editMessage);
        console.log('✅ Edit instruction message sent');
      }
      
    } catch (error) {
      console.error('❌ Error handling validation response:', error);
    }
  }

  async sendCategoryPoll(groupId, processedInfo, senderName) {
    try {
      let pollQuestion = `🔔 DEFINIR CATEGORIA\n\n`;
      pollQuestion += `📍 De: ${senderName}\n\n`;
      pollQuestion += `━━━━━━━━━━━━━━━━━━\n`;
      pollQuestion += `🤖 DADOS DETECTADOS:\n`;
      
      if (processedInfo.tipo_documento) {
        pollQuestion += `📄 Tipo: ${processedInfo.tipo_documento}\n`;
      }
      
      if (processedInfo.valor) {
        pollQuestion += `💰 Valor: ${processedInfo.valor}\n`;
      }
      
      if (processedInfo.data) {
        pollQuestion += `📅 Data: ${processedInfo.data}\n`;
      }
      
      if (processedInfo.descricao) {
        pollQuestion += `📝 ${processedInfo.descricao}\n`;
      }
      
      if (processedInfo.pagador) {
        pollQuestion += `💳 Pagador: ${processedInfo.pagador}\n`;
      }
      
      pollQuestion += `\n━━━━━━━━━━━━━━━━━━\n\n`;
      pollQuestion += `⚠️ *Categoria ambígua detectada!*\n\n`;
      pollQuestion += `Este lançamento pode ser Material ou Mão de Obra.\n`;
      pollQuestion += `Por favor, escolha a categoria:\n\n`;
      pollQuestion += `🧱 *Material* - Digite: material ou 1\n`;
      pollQuestion += `👷 *Mão de Obra* - Digite: mao de obra ou 2`;
      
      await this.client.sendMessage(groupId, pollQuestion);
      console.log('✅ Category selection poll sent');
      
    } catch (error) {
      console.error('❌ Error sending category poll:', error);
    }
  }

  async sendValidationPoll(groupId, processedInfo, senderName) {
    try {
      let pollQuestion = `🔔 VALIDAR LANÇAMENTO\n\n`;
      pollQuestion += `📍 De: ${senderName}\n\n`;
      pollQuestion += `━━━━━━━━━━━━━━━━━━\n`;
      pollQuestion += `🤖 DADOS DETECTADOS:\n`;
      
      if (processedInfo.tipo_documento && processedInfo.tipo_documento !== 'unknown') {
        pollQuestion += `📄 Documento: ${processedInfo.tipo_documento}\n`;
      }
      
      if (processedInfo.valor) {
        pollQuestion += `💰 Valor: ${processedInfo.valor}\n`;
      }
      
      if (processedInfo.data) {
        pollQuestion += `📅 Data: ${processedInfo.data}\n`;
      }
      
      if (processedInfo.categoria) {
        pollQuestion += `📋 Categoria: ${processedInfo.categoria}\n`;
      }
      
      if (processedInfo.descricao) {
        pollQuestion += `📝 ${processedInfo.descricao}\n`;
      }
      
      if (processedInfo.pagador) {
        pollQuestion += `💳 Pagador: ${processedInfo.pagador}\n`;
      }
      
      pollQuestion += `\n━━━━━━━━━━━━━━━━━━\n\n`;
      pollQuestion += `Para autorizar o lançamento, responda:\n`;
      pollQuestion += `✅ *Sim* - Aprovar\n`;
      pollQuestion += `❌ *Não* - Rejeitar\n`;
      pollQuestion += `✏️ *Editar* - Edição manual`;
      
      await this.client.sendMessage(groupId, pollQuestion);
      console.log('✅ Validation poll sent');
      
    } catch (error) {
      console.error('❌ Error sending validation poll:', error);
    }
  }

  async handleMessage(message) {
    console.log(`🚨 ENTRY: handleMessage START`);
    try {
      console.log(`🔍 DEBUG: handleMessage called, message type: ${message.type}`);
      console.log(`🔍 DEBUG: message body: ${message.body}`);
      
      const chat = await message.getChat();
      
      // Only process group messages
      if (!chat.isGroup) {
        console.log(`🔍 DEBUG: Skipping non-group message`);
        return;
      }

      console.log(`📨 Message from group: ${chat.name}`);
      
      // Check if this is a poll response (legacy)
      if (message.type === 'poll_creation') {
        console.log('📊 Poll created, skipping...');
        return;
      }

      const contact = await message.getContact();
      
      // Check if this is a category response (Material / Mão de Obra)
      const messageText = (message.body || '').trim().toLowerCase();
      console.log(`🔍 DEBUG: Message text = "${messageText}"`);
      
      if (messageText === 'material' || messageText === '1' || 
          messageText === 'mao de obra' || messageText === 'mão de obra' || messageText === 'mao' || messageText === '2') {
        console.log(`📊 Category response detected: ${messageText}`);
        await this.handleCategoryResponse(message, contact, chat);
        return; // Don't process as regular message
      }
      
      // Check if this is a validation response (Sim/Não/Editar)
      if (messageText === 'sim' || messageText === 'não' || messageText === 'nao' || messageText === 'editar') {
        console.log(`📊 Validation response detected: ${messageText}`);
        await this.handleValidationResponse(message, contact, chat);
        return; // Don't process as regular message
      }
      
      // Build message data
      const messageData = {
        group_name: chat.name,
        group_id: chat.id._serialized,
        sender: contact.id._serialized,
        sender_name: contact.pushname || contact.name || 'Unknown',
        timestamp: new Date(message.timestamp * 1000).toISOString(),
        type: message.type,
        text: message.body || '',
        media: null,
        media_mime: null,
        media_filename: null,
        validation_required: true  // Always true for regular processing
      };

      // Handle media
      if (message.hasMedia) {
        try {
          console.log(`📎 Downloading media (${message.type})...`);
          const media = await message.downloadMedia();
          
          if (media) {
            messageData.media = media.data; // Base64
            messageData.media_mime = media.mimetype;
            messageData.media_filename = media.filename || `file_${Date.now()}`;
            console.log(`✅ Media downloaded: ${messageData.media_filename}`);
          }
        } catch (error) {
          console.error('❌ Error downloading media:', error);
        }
      }

      // Send to backend webhook
      console.log('📡 Sending to webhook:', {text: messageData.text, validation_required: messageData.validation_required});
      const response = await this.sendToWebhook(messageData);
      
      console.log('📥 Webhook response received:');
      console.log('  - Status:', response ? response.status : 'null');
      console.log('  - Has message:', response ? ('message' in response) : false);
      console.log('  - Message value:', response ? response.message : 'null');
      
      // Handle command responses (diary, cadastro, report, etc) - these should come FIRST
      if (response && response.status) {
        const commandStatuses = [
          'registration_mode_activated',
          'registration_completed', 
          'registration_failed',
          'registration_cancelled',
          'context_learned',
          'diary_started',
          'diary_ended',
          'report_generated'
        ];
        
        console.log('🔍 Checking if status is a command:', response.status, 'in', commandStatuses);
        
        if (commandStatuses.includes(response.status)) {
          console.log(`✅ Command status detected: ${response.status}`);
          
          if (response.message) {
            console.log(`📤 Sending message to group: ${response.message.substring(0, 50)}...`);
            await this.client.sendMessage(chat.id._serialized, response.message);
            console.log(`✅ Message sent successfully`);
          } else {
            console.log(`⚠️ No message field in response!`);
          }
          
          return;
        } else {
          console.log(`📝 Not a command status, continuing normal flow`);
        }
      } else {
        console.log(`⚠️ No response or no status in response`);
      }
      
      // ✅ NEW: Check if needs category selection first
      if (response && response.status === 'needs_category_selection') {
        console.log('⚠️ Category selection needed');
        const processedInfo = response.processed_info || {};
        
        await this.sendCategoryPoll(chat.id._serialized, processedInfo, messageData.sender_name);
        return;
      }
      
      // If webhook returns pending_id, send validation poll with processed data
      if (response && response.pending_id) {
        console.log('📤 Building validation poll with processed data...');
        
        const processedInfo = response.processed_info || {};
        
        await this.sendValidationPoll(chat.id._serialized, processedInfo, messageData.sender_name);
        
        // Store pending validation
        this.pendingValidations = this.pendingValidations || {};
        this.pendingValidations[response.pending_id] = {
          groupId: chat.id._serialized,
          messageData: messageData,
          processedData: processedInfo,
          uploadId: response.upload_id
        };
      }

    } catch (error) {
      console.error('❌ Error handling message:', error);
      console.error('❌ Error stack:', error.stack);
      console.error('❌ Error message:', error.message);
    }
  }

  async handlePollVote(vote) {
    try {
      console.log('📊 Poll vote received [NEW CODE v2]');
      
      // Get poll message
      const parentMsgId = vote.parentMessage.id._serialized;
      const pollVotes = await this.client.getPollVotes(parentMsgId);
      
      console.log('Poll votes received:', pollVotes.length, 'votes');
      console.log('🔍 All poll votes:', JSON.stringify(pollVotes, null, 2));
      console.log('🔍 Looking for voter:', vote.voter);
      
      // Find the vote from this specific voter
      const voterVote = pollVotes.find(v => v.voter === vote.voter);
      
      if (!voterVote) {
        console.log('❌ Could not find vote from this voter');
        return;
      }
      
      // Debug: log the entire vote object
      console.log('🔍 Voter vote object:', JSON.stringify(voterVote, null, 2));
      
      // selectedOptions is an array of objects with {name, localId}
      let selectedOptionIndex;
      if (Array.isArray(voterVote.selectedOptions) && voterVote.selectedOptions.length > 0) {
        const firstOption = voterVote.selectedOptions[0];
        // Extract the localId from the option object
        selectedOptionIndex = firstOption.localId !== undefined ? firstOption.localId : firstOption;
      } else if (typeof voterVote.selectedOptions === 'object' && voterVote.selectedOptions !== null) {
        // If it's a single object, try to get localId
        selectedOptionIndex = voterVote.selectedOptions.localId !== undefined ? voterVote.selectedOptions.localId : Object.values(voterVote.selectedOptions)[0];
      } else {
        selectedOptionIndex = voterVote.selectedOptions;
      }
      
      console.log(`✅ Vote: Option index ${selectedOptionIndex} (type: ${typeof selectedOptionIndex}) by ${vote.voter}`);
      
      // Send vote to backend for processing
      const voteResponse = await axios.post(`${this.fastApiUrl}/api/whatsapp/poll-vote`, {
        poll_id: parentMsgId,
        voter: vote.voter,
        voter_name: vote.voter,
        selected_option: String(selectedOptionIndex),  // Convert to string for backend
        group_id: vote.parentMessage.from
      });
      
      console.log('✅ Vote sent to backend');
      
      // If backend requests to send confirmation (e.g., for SIM - approved)
      if (voteResponse.data && voteResponse.data.send_confirmation) {
        console.log('📤 Sending payment confirmation message...');
        const groupId = voteResponse.data.group_id;
        const valor = voteResponse.data.valor || 'N/A';
        const confirmationMessage = `✅ Pagamento ${valor} lançado.`;
        
        await this.client.sendMessage(groupId, confirmationMessage);
        console.log('✅ Payment confirmation message sent');
      }
      
      // If backend requests to send a message (e.g., for EDITAR option)
      if (voteResponse.data && voteResponse.data.send_message) {
        console.log('📤 Sending edit instruction message...');
        const groupId = voteResponse.data.group_id;
        const editMessage = `✏️ *EDIÇÃO MANUAL SOLICITADA*\n\n` +
          `Por favor, adicione o gasto manualmente no sistema.\n\n` +
          `O sistema não conseguiu processar automaticamente este documento.\n` +
          `Acesse o painel web para inserir os dados manualmente.`;
        
        await this.client.sendMessage(groupId, editMessage);
        console.log('✅ Edit instruction message sent');
      }
      
    } catch (error) {
      console.error('❌ Error handling poll vote:', error);
      console.error(error.stack);
    }
  }

  async sendToWebhook(data) {
    try {
      const url = `${this.fastApiUrl}/api/whatsapp/webhook`;
      console.log(`📤 Sending to webhook: ${url}`);
      
      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds
      });

      console.log('✅ Webhook response:', response.status);
      return response.data;
    } catch (error) {
      console.error('❌ Error sending to webhook:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  async getStatus() {
    return {
      connected: this.isReady,
      hasQR: !!this.qrCode,
      client_state: this.client?.info?.wid ? 'authenticated' : 'disconnected'
    };
  }

  getQRCode() {
    return this.qrCode;
  }

  async getGroups() {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    const chats = await this.client.getChats();
    const groups = chats
      .filter(chat => chat.isGroup)
      .map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        participants_count: chat.participants ? chat.participants.length : 0
      }));

    return groups;
  }

  async logout() {
    if (this.client) {
      await this.client.logout();
      this.isReady = false;
      this.qrCode = null;
    }
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy();
      this.isReady = false;
      this.qrCode = null;
    }
  }
}

module.exports = WhatsAppClient;