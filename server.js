const express = require('express');
const cors = require('cors');
const WhatsAppManager = require('./whatsapp-manager');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8002;

app.use(cors());
app.use(express.json());

// Initialize WhatsApp Manager (handles multiple users)
const whatsappManager = new WhatsAppManager();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-service' });
});

// Get connection status (requires user_id)
app.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const status = await whatsappManager.getStatus(userId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize WhatsApp for a user (returns QR or status)
app.post('/initialize', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // Get or create client
    whatsappManager.getClient(userId);
    
    const status = await whatsappManager.getStatus(userId);
    const qr = whatsappManager.getQRCode(userId);
    
    res.json({ status, qr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get QR code for a user
app.get('/qr/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const qr = whatsappManager.getQRCode(userId);
    if (qr) {
      res.json({ qr });
    } else {
      res.json({ qr: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all groups for a user
app.get('/groups/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const groups = await whatsappManager.getGroups(userId);
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout a user
app.post('/logout/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await whatsappManager.logout(userId);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Service running on port ${PORT}`);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down WhatsApp service...');
  await whatsappManager.destroy();
  process.exit(0);
});
